from collections import OrderedDict
import re
import time

import requests

LRCLIB_BASE = "https://lrclib.net"
LRCLIB_HEADERS = {
    "User-Agent": "ZIZOMusic/1.0 (https://zizomusic.com)",
    "Lrclib-Client": "ZIZOMusic/1.0 (https://zizomusic.com)",
}
CACHE_TTL_HIT = 24 * 60 * 60
CACHE_TTL_MISS = 10 * 60
CACHE_MAX = 256
REQUEST_TIMEOUT = 8

_PAREN_NOISE = re.compile(
    r"\s*[\(\[][^)\]]*\b(official|lyric|audio|video|visualizer|remaster(?:ed)?"
    r"|explicit|hd|4k|topic|music video|lyric video)\b[^)\]]*[\)\]]",
    re.I,
)
_LRC_TAG = re.compile(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]")
_WORD_TAG = re.compile(r"<\d{1,2}:\d{2}(?:\.\d{1,3})?>")

_cache = OrderedDict()


def _clip(value, limit=200):
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def clean_title(title):
    cleaned = _PAREN_NOISE.sub("", _clip(title))
    return re.sub(r"\s+", " ", cleaned).strip(" -")


def clean_artist(artist):
    text = _clip(artist)
    if text.lower() in {"unknown", "zizo music"}:
        return ""
    return re.split(r"\s*(?:,|&| x )\s*", text, maxsplit=1, flags=re.I)[0].strip()


def _frac_seconds(frac):
    if not frac:
        return 0.0
    if len(frac) == 1:
        return int(frac) / 10.0
    if len(frac) == 2:
        return int(frac) / 100.0
    return int(frac) / 1000.0


def parse_lrc(synced):
    lines = []
    for raw in (synced or "").splitlines():
        tags = list(_LRC_TAG.finditer(raw))
        if not tags:
            continue
        text = _WORD_TAG.sub("", raw[tags[-1].end():]).strip()
        if not text:
            continue
        for tag in tags:
            minutes = int(tag.group(1))
            seconds = int(tag.group(2))
            stamp = minutes * 60 + seconds + _frac_seconds(tag.group(3))
            lines.append((stamp, text))
    lines.sort(key=lambda item: item[0])
    return [{"time": stamp, "text": text} for stamp, text in lines]


def plain_to_lines(text):
    return [
        {"time": 0.0, "text": line.strip()}
        for line in (text or "").splitlines()
        if line.strip()
    ]


def empty_payload(status="missing"):
    return {"status": status, "synced": False, "lines": []}


def payload_from_record(record):
    if not isinstance(record, dict):
        return empty_payload()
    if record.get("instrumental") and not record.get("syncedLyrics") and not record.get("plainLyrics"):
        return empty_payload("instrumental")
    synced_lines = parse_lrc(record.get("syncedLyrics") or "")
    if synced_lines:
        return {"status": "ok", "synced": True, "lines": synced_lines}
    plain_lines = plain_to_lines(record.get("plainLyrics") or "")
    if plain_lines:
        return {"status": "ok", "synced": False, "lines": plain_lines}
    if record.get("instrumental"):
        return empty_payload("instrumental")
    return empty_payload()


def _cache_get(key):
    entry = _cache.get(key)
    if not entry:
        return None
    expires_at, payload = entry
    if time.time() > expires_at:
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return payload


def _cache_put(key, payload):
    ttl = CACHE_TTL_HIT if payload.get("status") != "missing" else CACHE_TTL_MISS
    _cache[key] = (time.time() + ttl, payload)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_MAX:
        _cache.popitem(last=False)


def _lrclib_request(path, params):
    try:
        response = requests.get(
            f"{LRCLIB_BASE}{path}",
            params=params,
            headers=LRCLIB_HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as error:
        print(f"LRCLIB request failed: {error}")
        return None
    if response.status_code == 404:
        return None
    if response.status_code == 429:
        print("LRCLIB rate limited")
        return None
    if response.status_code != 200:
        print(f"LRCLIB HTTP {response.status_code}")
        return None
    try:
        return response.json()
    except ValueError:
        return None


def _score_record(record, title, artist, duration):
    if not isinstance(record, dict):
        return -1
    score = 0
    if record.get("syncedLyrics"):
        score += 100
    elif record.get("plainLyrics"):
        score += 40
    elif record.get("instrumental"):
        score += 10
    else:
        return -1

    rec_title = (record.get("trackName") or "").lower()
    rec_artist = (record.get("artistName") or "").lower()
    title_l = title.lower()
    artist_l = artist.lower()
    if title_l and (title_l == rec_title or title_l in rec_title or rec_title in title_l):
        score += 25
    if artist_l and (artist_l == rec_artist or artist_l in rec_artist or rec_artist in artist_l):
        score += 20

    rec_duration = record.get("duration") or 0
    if duration and rec_duration:
        diff = abs(float(rec_duration) - duration)
        if diff <= 2:
            score += 40
        elif diff <= 5:
            score += 25
        elif diff <= 12:
            score += 8
        elif diff > 25:
            score -= 30
    return score


def fetch_lrclib(title, artist, duration):
    if title and artist:
        record = _lrclib_request("/api/get", {
            "track_name": title,
            "artist_name": artist,
            **({"duration": int(round(duration))} if duration and 1 <= duration <= 3600 else {}),
        })
        payload = payload_from_record(record)
        if payload["status"] != "missing":
            return payload

        results = _lrclib_request("/api/search", {
            "track_name": title,
            "artist_name": artist,
        })
        if isinstance(results, list) and results:
            ranked = sorted(
                results,
                key=lambda item: _score_record(item, title, artist, duration),
                reverse=True,
            )
            if _score_record(ranked[0], title, artist, duration) > 0:
                return payload_from_record(ranked[0])

    query = " ".join(part for part in (title, artist) if part).strip()
    if not query:
        return empty_payload()
    results = _lrclib_request("/api/search", {"q": query})
    if not isinstance(results, list) or not results:
        return empty_payload()
    ranked = sorted(
        results,
        key=lambda item: _score_record(item, title, artist, duration),
        reverse=True,
    )
    if _score_record(ranked[0], title, artist, duration) <= 0:
        return empty_payload()
    return payload_from_record(ranked[0])


def _lyric_line_fields(line):
    if hasattr(line, "text"):
        start = getattr(line, "start_time", 0) or 0
        return str(line.text or "").strip(), start / 1000.0
    if isinstance(line, dict):
        start = line.get("start_time") or line.get("startTime") or 0
        return str(line.get("text") or "").strip(), start / 1000.0
    return "", 0.0


def fetch_ytmusic(ytmusic, title, artist, query):
    if ytmusic is None:
        return empty_payload()
    search_q = _clip(query) or " ".join(part for part in (title, artist) if part).strip()
    if not search_q:
        return empty_payload()
    try:
        results = ytmusic.search(search_q, filter="songs", limit=1)
        if not results:
            return empty_payload()
        video_id = results[0].get("videoId")
        if not video_id:
            return empty_payload()
        watch = ytmusic.get_watch_playlist(videoId=video_id)
        lyrics_id = watch.get("lyrics") if isinstance(watch, dict) else None
        if not lyrics_id:
            return empty_payload()
        timed = ytmusic.get_lyrics(lyrics_id, timestamps=True)
        if timed and timed.get("hasTimestamps") and timed.get("lyrics"):
            lines = []
            for line in timed["lyrics"]:
                text, stamp = _lyric_line_fields(line)
                if text:
                    lines.append({"time": stamp, "text": text})
            if lines:
                return {"status": "ok", "synced": True, "lines": lines}
        plain = timed if timed and not timed.get("hasTimestamps") else ytmusic.get_lyrics(lyrics_id)
        lyrics_text = (plain or {}).get("lyrics") if isinstance(plain, dict) else None
        lines = plain_to_lines(lyrics_text)
        if lines:
            return {"status": "ok", "synced": False, "lines": lines}
    except Exception as error:
        print(f"YouTube Music lyrics failed: {error}")
    return empty_payload()


def lookup_lyrics(title="", artist="", duration=0, query="", ytmusic=None):
    raw_title = _clip(title)
    raw_artist = _clip(artist)
    query = _clip(query)
    try:
        duration = float(duration or 0)
    except (TypeError, ValueError):
        duration = 0
    if duration < 1 or duration > 3600:
        duration = 0

    title = clean_title(raw_title) or clean_title(query) or raw_title
    artist = clean_artist(raw_artist)
    if not title and not query:
        return empty_payload()

    cache_key = f"{title.lower()}|{artist.lower()}|{int(round(duration))}|{query.lower()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    payload = fetch_lrclib(title, artist, duration)
    if payload["status"] == "missing":
        payload = fetch_ytmusic(ytmusic, title, artist, query)

    _cache_put(cache_key, payload)
    return payload
