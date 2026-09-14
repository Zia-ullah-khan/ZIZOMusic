from fastapi import FastAPI, HTTPException, WebSocket, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from collections import OrderedDict
from urllib.parse import quote
import os
import re
import time
import asyncio
import json
import uuid
import YouTubeMusicAPI
from ytmusicapi import YTMusic
from download import download_audio_from_url
from fuzzy_search import rank_suggestions
from recommendation_engine import RecommendationEngine
import hls

app = FastAPI()

if not hls.ffmpeg_available():
    print("WARNING: ffmpeg not found, adaptive HLS streaming disabled, falling back to direct streams")
rec_engine = RecommendationEngine()
ytmusic = YTMusic()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SONGS_DIR = "./songs"
MAPPING_FILE = "song_mappings.json"
os.makedirs(SONGS_DIR, exist_ok=True)

SUGGESTION_CACHE_TTL = 600
SUGGESTION_CACHE_MAX = 256
PREFETCH_SCORE_THRESHOLD = 0.85

_suggestion_cache = OrderedDict()
_prefetching = set()


class PrefetchRequest(BaseModel):
    video_id: str
    query: str = ""

def load_mappings():
    if os.path.exists(MAPPING_FILE):
        try:
            with open(MAPPING_FILE, "r") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_mapping(song_name, filename):
    mappings = load_mappings()
    mappings[song_name] = filename
    with open(MAPPING_FILE, "w") as f:
        json.dump(mappings, f, indent=2)

async def update_profile_async(song_name, user_id):
    print(f"Starting async profile update for {song_name}, user: {user_id}")
    try:
        loop = asyncio.get_running_loop()
        results = await loop.run_in_executor(None, lambda: ytmusic.search(song_name, filter='songs', limit=1))
        if results:
            metadata = results[0]
            print(f"Found metadata for {song_name}, updating profile...")
            rec_engine.update_profile(metadata, user_id)
        else:
            print(f"No metadata found for {song_name}")
    except Exception as e:
        print(f"Error updating profile async: {e}")

_song_locks = {}
PREWARM_COUNT = 1
SONG_ID_PATTERN = re.compile(r"^[0-9a-f]{16}$")
VARIANT_PATTERN = re.compile(r"^v\d{2,3}$")
SEGMENT_PATTERN = re.compile(r"^(seg\d{4}\.ts|playlist\.m3u8)$")


def _lock_for(song_name):
    lock = _song_locks.get(song_name)
    if lock is None:
        lock = asyncio.Lock()
        _song_locks[song_name] = lock
    return lock


async def get_song_path(song_name: str, user_id: str = None, priority: bool = True):
    async with _lock_for(song_name):
        return await _get_song_path(song_name, user_id, priority)


async def _get_song_path(song_name: str, user_id: str = None, priority: bool = True):
    mappings = load_mappings()
    if song_name in mappings:
        mapped_file = mappings[song_name]
        full_path = os.path.join(SONGS_DIR, os.path.basename(mapped_file))
        if os.path.exists(full_path):
            if user_id:
                asyncio.create_task(update_profile_async(song_name, user_id))
            return full_path

    safe_song_name = song_name.replace("/", "_").replace("\\", "_")
    existing_files = os.listdir(SONGS_DIR)
    target_file = None
    
    query_tokens = safe_song_name.lower().split()
    ignored_words = {"by", "official", "video", "lyrics", "audio", "ft", "feat", "prod"}
    filtered_tokens = [t for t in query_tokens if t not in ignored_words]
    
    if not filtered_tokens:
        filtered_tokens = query_tokens
    
    for file in existing_files:
        file_lower = file.lower()
        if all(token in file_lower for token in filtered_tokens):
            target_file = os.path.join(SONGS_DIR, file)
            save_mapping(song_name, file)
            if user_id:
                asyncio.create_task(update_profile_async(song_name, user_id))
            return target_file

    if not target_file:
        print(f"Song '{song_name}' not found locally. Searching and downloading...")
        try:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(None, YouTubeMusicAPI.search, song_name)
            if results and 'url' in results:
                url = results['url']
                result = await loop.run_in_executor(
                    None,
                    download_audio_from_url,
                    url,
                    SONGS_DIR,
                    "%(title)s.%(ext)s",
                    priority,
                )
                target_file, info = result
                
                if user_id:
                    rec_engine.update_profile(info, user_id)
                
                if target_file:
                    save_mapping(song_name, os.path.basename(target_file))
            else:
                return None
        except Exception as e:
            print(f"Error downloading: {e}")
            return None
            
    return target_file

def suggestion_cache_get(key):
    entry = _suggestion_cache.get(key)
    if not entry:
        return None
    timestamp, payload = entry
    if time.time() - timestamp > SUGGESTION_CACHE_TTL:
        _suggestion_cache.pop(key, None)
        return None
    _suggestion_cache.move_to_end(key)
    return payload

def suggestion_cache_put(key, payload):
    _suggestion_cache[key] = (time.time(), payload)
    _suggestion_cache.move_to_end(key)
    while len(_suggestion_cache) > SUGGESTION_CACHE_MAX:
        _suggestion_cache.popitem(last=False)

def search_songs(query, limit):
    return ytmusic.search(query, filter="songs", limit=limit)

def fetch_suggestion_texts(query):
    try:
        return [text for text in ytmusic.get_search_suggestions(query) if isinstance(text, str)]
    except Exception as e:
        print(f"Suggestion texts failed: {e}")
        return []

def is_cached(key):
    if not key:
        return False
    mappings = load_mappings()
    if key not in mappings:
        return False
    return os.path.exists(os.path.join(SONGS_DIR, os.path.basename(mappings[key])))

async def prefetch_audio(video_id, play_key):
    if video_id in _prefetching:
        return
    _prefetching.add(video_id)
    print(f"Prefetching audio for {video_id}")
    try:
        url = f"https://www.youtube.com/watch?v={video_id}"
        loop = asyncio.get_running_loop()
        target_file, info = await loop.run_in_executor(
            None, download_audio_from_url, url, SONGS_DIR, "%(title)s.%(ext)s", False
        )
        if target_file:
            filename = os.path.basename(target_file)
            save_mapping(video_id, filename)
            if play_key:
                save_mapping(play_key, filename)
            print(f"Prefetch complete: {filename}")
            if hls.ffmpeg_available():
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, hls.build_hls, target_file)
    except Exception as e:
        print(f"Prefetch failed for {video_id}: {e}")
    finally:
        _prefetching.discard(video_id)

def maybe_prefetch_top(suggestions):
    if not suggestions:
        return
    top = suggestions[0]
    if top["score"] <= PREFETCH_SCORE_THRESHOLD:
        return
    play_key = f"{top['title']} {top['artist']}".strip()
    if is_cached(top["id"]) or is_cached(play_key):
        return
    asyncio.create_task(prefetch_audio(top["id"], play_key))

@app.get("/search/suggestions")
async def search_suggestions(q: str, limit: int = 5):
    query = q.strip()
    limit = max(1, min(limit, 10))
    if len(query) < 2:
        return {"query": q, "suggestions": []}

    cache_key = f"{query.lower()}:{limit}"
    cached = suggestion_cache_get(cache_key)
    if cached:
        maybe_prefetch_top(cached["suggestions"])
        return cached

    loop = asyncio.get_running_loop()
    results, texts = await asyncio.gather(
        loop.run_in_executor(None, search_songs, query, limit),
        loop.run_in_executor(None, fetch_suggestion_texts, query),
        return_exceptions=True,
    )
    if isinstance(results, Exception):
        print(f"Search failed: {results}")
        results = []
    if isinstance(texts, Exception):
        texts = []

    suggestions = rank_suggestions(query, results, texts, limit)

    top_score = suggestions[0]["score"] if suggestions else 0.0
    if texts and (len(suggestions) < limit or top_score < 0.6):
        corrected = texts[0].strip()
        if corrected and corrected.lower() != query.lower():
            try:
                extra = await loop.run_in_executor(None, search_songs, corrected, limit)
                suggestions = rank_suggestions(query, list(results) + list(extra), texts, limit)
            except Exception as e:
                print(f"Corrected search failed: {e}")

    payload = {"query": q, "suggestions": suggestions}
    suggestion_cache_put(cache_key, payload)
    maybe_prefetch_top(suggestions)
    return payload

@app.post("/cache/prefetch")
async def cache_prefetch(request: PrefetchRequest):
    video_id = request.video_id.strip()
    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required")

    play_key = request.query.strip()
    if is_cached(video_id) or is_cached(play_key):
        return {"status": "cached", "video_id": video_id}
    if video_id in _prefetching:
        return {"status": "downloading", "video_id": video_id}

    asyncio.create_task(prefetch_audio(video_id, play_key))
    return {"status": "started", "video_id": video_id}

async def prewarm_song(song_name: str):
    try:
        target_file = await get_song_path(song_name, priority=False)
        if target_file and os.path.exists(target_file) and hls.ffmpeg_available():
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, hls.build_hls, target_file)
    except Exception as e:
        print(f"Prewarm failed for {song_name}: {e}")


@app.get("/recommend")
async def recommend_songs(user_id: str = None):
    if not user_id:
        user_id = str(uuid.uuid4())
    
    recommendations = rec_engine.get_recommendations(user_id)

    for rec in recommendations[:PREWARM_COUNT]:
        query = rec.get("query") if isinstance(rec, dict) else None
        if query and len(query) < 80:
            asyncio.create_task(prewarm_song(query))

    return {"user_id": user_id, "recommendations": recommendations}

@app.get("/info/{song_name}")
def get_song_info(song_name: str):
    try:
        results = ytmusic.search(song_name, filter='songs', limit=1)
        if results:
            track = results[0]
            thumbnails = track.get('thumbnails', [])
            thumbnail_url = thumbnails[-1]['url'] if thumbnails else ""
            artists = track.get('artists', [])
            artist_name = artists[0]['name'] if artists else ""
            duration = track.get('duration_seconds') or 0
            return {
                "title": track.get('title'),
                "artist": artist_name,
                "thumbnail": thumbnail_url,
                "duration": duration
            }
    except Exception as e:
        print(f"Error fetching info: {e}")
    return {"title": song_name, "artist": "Unknown", "thumbnail": ""}

@app.websocket("/ws/stream/{song_name}")
async def websocket_endpoint(websocket: WebSocket, song_name: str):
    await websocket.accept()
    try:
        target_file = await get_song_path(song_name)
        
        if target_file and os.path.exists(target_file):
            chunk_size = 4096 * 4
            with open(target_file, "rb") as f:
                while True:
                    data = f.read(chunk_size)
                    if not data:
                        break
                    await websocket.send_bytes(data)
                    await asyncio.sleep(0.01)
            await websocket.close()
        else:
            await websocket.close(code=1000, reason="Song not found")
    except Exception as e:
        print(f"WebSocket error: {e}")

@app.get("/play/{song_name}")
async def play_song(song_name: str, user_id: str = None):
    target_file = await get_song_path(song_name, user_id)
    if not target_file or not os.path.exists(target_file):
        raise HTTPException(status_code=404, detail="Song not found")

    if hls.ffmpeg_available():
        try:
            loop = asyncio.get_running_loop()
            song_id = await loop.run_in_executor(None, hls.build_hls, target_file)
            return {"type": "hls", "url": f"/hls/{song_id}/master.m3u8"}
        except Exception as e:
            print(f"HLS transcode failed, falling back to direct stream: {e}")

    return {"type": "default", "url": f"/stream/{quote(song_name)}"}


@app.get("/hls/{song_id}/master.m3u8")
async def hls_master(song_id: str):
    if not SONG_ID_PATTERN.match(song_id):
        raise HTTPException(status_code=404, detail="Not found")

    path = hls.hls_path(song_id, "master.m3u8")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")

    return FileResponse(path, media_type="application/vnd.apple.mpegurl")


@app.get("/hls/{song_id}/{variant}/{filename}")
async def hls_media(song_id: str, variant: str, filename: str):
    if not (SONG_ID_PATTERN.match(song_id) and VARIANT_PATTERN.match(variant) and SEGMENT_PATTERN.match(filename)):
        raise HTTPException(status_code=404, detail="Not found")

    path = hls.hls_path(song_id, variant, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")

    media_type = "application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else "video/mp2t"
    return FileResponse(path, media_type=media_type)


@app.get("/stream/{song_name}")
async def stream_song(song_name: str, user_id: str = None):
    """
    Streams a song. If the song doesn't exist, it tries to download it first.
    """
    target_file = await get_song_path(song_name, user_id)
    if target_file and os.path.exists(target_file):
        return FileResponse(target_file, media_type="audio/mpeg", filename=os.path.basename(target_file))
    else:
        raise HTTPException(status_code=404, detail="File not found")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "favicon.png")
    if os.path.exists(file_path):
        return FileResponse(file_path)
    return HTTPException(status_code=404, detail="Favicon not found")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    songs_count = len(os.listdir(SONGS_DIR)) if os.path.exists(SONGS_DIR) else 0
    
    mappings_count = 0
    if os.path.exists(MAPPING_FILE):
        try:
            with open(MAPPING_FILE, "r") as f:
                mappings_count = len(json.load(f))
        except:
            pass
            
    profiles_dir = os.path.join("API", "profiles")
    profiles_count = len(os.listdir(profiles_dir)) if os.path.exists(profiles_dir) else 0

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>ZIZO Music API</title>
        <style>
            body {{ font-family: sans-serif; background-color: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
            h1 {{ color: #DC2626; font-size: 3rem; margin-bottom: 1rem; }}
            .stats {{ display: flex; gap: 2rem; margin-top: 2rem; }}
            .stat-box {{ background: #18181b; padding: 1.5rem; border-radius: 10px; text-align: center; min-width: 150px; border: 1px solid #333; }}
            .stat-value {{ font-size: 2.5rem; font-weight: bold; color: #fff; }}
            .stat-label {{ color: #888; margin-top: 0.5rem; }}
            a {{ color: #DC2626; text-decoration: none; margin-top: 2rem; }}
            a:hover {{ text-decoration: underline; }}
        </style>
    </head>
    <body>
        <h1>ZIZO Music API</h1>
        <p>Backend Server Status: <strong>Online</strong></p>
        
        <div class="stats">
            <div class="stat-box">
                <div class="stat-value">{songs_count}</div>
                <div class="stat-label">Cached Songs</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">{mappings_count}</div>
                <div class="stat-label">Song Mappings</div>
            </div>
            <div class="stat-box">
                <div class="stat-value">{profiles_count}</div>
                <div class="stat-label">Active Profiles</div>
            </div>
        </div>
        
        <a href="/docs">View API Documentation</a>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content, status_code=200)

@app.exception_handler(404)
async def custom_404_handler(request: Request, exc: HTTPException):
    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>404 - Not Found</title>
        <style>
            body { font-family: sans-serif; background-color: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            h1 { color: #DC2626; font-size: 4rem; margin-bottom: 0; }
            p { color: #888; font-size: 1.5rem; }
            a { color: #fff; background: #DC2626; padding: 10px 20px; border-radius: 5px; text-decoration: none; margin-top: 2rem; font-weight: bold; }
            a:hover { background: #b91c1c; }
        </style>
    </head>
    <body>
        <h1>404</h1>
        <p>Page Not Found</p>
        <a href="/">Return Home</a>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content, status_code=404)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
