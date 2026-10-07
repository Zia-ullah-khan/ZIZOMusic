import os
import re
import shutil
import threading
import yt_dlp
from ffmpeg_bin import ffmpeg_path

_state = threading.Condition()
_user_waiters = 0
_busy = False

_WATCH_ID = re.compile(
    r"(?:v=|/watch(?:\?|/.+\?)v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})"
)


def normalize_youtube_url(url):
    if not url:
        return url
    match = _WATCH_ID.search(url)
    if match:
        return f"https://www.youtube.com/watch?v={match.group(1)}"
    return url


def _js_runtimes():
    runtimes = {}
    if shutil.which("node"):
        runtimes["node"] = {}
    if shutil.which("deno"):
        runtimes["deno"] = {}
    if shutil.which("bun"):
        runtimes["bun"] = {}
    return runtimes or {"node": {}}


def _acquire(priority):
    global _user_waiters, _busy
    with _state:
        if priority:
            _user_waiters += 1
            return
        while _busy or _user_waiters > 0:
            _state.wait()
        _busy = True


def _release(priority):
    global _user_waiters, _busy
    with _state:
        if priority:
            _user_waiters -= 1
        else:
            _busy = False
        _state.notify_all()


def _base_opts(output_dir, filename_template):
    opts = {
        "outtmpl": os.path.join(output_dir, filename_template),
        "noplaylist": True,
        "quiet": False,
        "no_warnings": False,
        "retries": 5,
        "fragment_retries": 5,
        "extractor_retries": 3,
        "concurrent_fragment_downloads": 1,
        "js_runtimes": _js_runtimes(),
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "Referer": "https://www.youtube.com/",
            "Origin": "https://www.youtube.com",
        },
    }
    modern = ffmpeg_path()
    if modern:
        opts["ffmpeg_location"] = modern
    else:
        opts["fixup"] = "never"
    return opts


# Prefer clients that still return direct media URLs under YouTube SABR.
_ATTEMPTS = [
    {
        "format": "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best",
        "extractor_args": {
            "youtube": {"player_client": ["android_sdkless", "android", "ios"]},
        },
    },
    {
        "format": "bestaudio/best/18",
        "extractor_args": {
            "youtube": {"player_client": ["mweb", "tv", "tv_simply", "web_safari"]},
        },
    },
    {
        "format": "bestaudio[ext=m4a]/bestaudio/best/18",
        "extractor_args": {
            "youtube": {"player_client": ["default"]},
        },
    },
]


def download_audio_from_url(
    url,
    output_dir="./downloads",
    filename_template="%(title)s.%(ext)s",
    priority=False,
):
    os.makedirs(output_dir, exist_ok=True)
    url = normalize_youtube_url(url)
    last_error = None
    _acquire(priority)

    try:
        for attempt in _ATTEMPTS:
            opts = _base_opts(output_dir, filename_template)
            opts.update(attempt)
            clients = (
                (attempt.get("extractor_args") or {})
                .get("youtube", {})
                .get("player_client", ["default"])
            )
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    filename = ydl.prepare_filename(info)
                    downloads = info.get("requested_downloads") or []
                    if downloads:
                        filename = downloads[0].get("filepath") or filename
                    if filename and os.path.exists(filename):
                        return filename, info
                    last_error = RuntimeError(f"Download finished without a file: {filename}")
            except Exception as e:
                last_error = e
                print(f"Download attempt failed ({clients} / {attempt.get('format')}): {e}")
    finally:
        _release(priority)

    raise last_error or RuntimeError(f"Failed to download {url}")
