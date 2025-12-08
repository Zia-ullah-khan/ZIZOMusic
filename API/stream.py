from fastapi import FastAPI, HTTPException, WebSocket, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import asyncio
import json
import uuid
import YouTubeMusicAPI
from ytmusicapi import YTMusic
from download import download_audio_from_url
from recommendation_engine import RecommendationEngine

app = FastAPI()
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

async def get_song_path(song_name: str, user_id: str = None):
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
                result = await loop.run_in_executor(None, download_audio_from_url, url, SONGS_DIR, "%(title)s.%(ext)s")
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

@app.get("/recommend")
async def recommend_songs(user_id: str = None):
    if not user_id:
        user_id = str(uuid.uuid4())
    
    recommendations = rec_engine.get_recommendations(user_id)
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
            return {
                "title": track.get('title'),
                "artist": artist_name,
                "thumbnail": thumbnail_url
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
    return FileResponse(r"D:\Projects\YoutubeMusic\API\favicon.png")

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
