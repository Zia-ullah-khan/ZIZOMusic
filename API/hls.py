import hashlib
import os
import shutil
import subprocess
import threading
from ffmpeg_bin import ffmpeg_available, ffmpeg_path

HLS_DIR = "./hls"
HLS_VERSION = "2"
SEGMENT_SECONDS = 4

VARIANTS = [
    {"name": "v48", "bitrate": 48, "profile": "aac_he_v2"},
    {"name": "v64", "bitrate": 64, "profile": "aac_he"},
    {"name": "v128", "bitrate": 128, "profile": "aac_low"},
]

MASTER_ORDER = ["v48", "v64", "v128"]

os.makedirs(HLS_DIR, exist_ok=True)

_song_locks = {}
_song_locks_guard = threading.Lock()
_user_encodes = 0
_bg_busy = False
_encode_state = threading.Condition()
_scheduled = set()


def _lock_for_song(song_id):
    with _song_locks_guard:
        lock = _song_locks.get(song_id)
        if lock is None:
            lock = threading.Lock()
            _song_locks[song_id] = lock
        return lock


def _acquire_encode(priority):
    global _user_encodes, _bg_busy
    with _encode_state:
        if priority:
            _user_encodes += 1
            return
        while _user_encodes > 0 or _bg_busy:
            _encode_state.wait()
        _bg_busy = True


def _release_encode(priority):
    global _user_encodes, _bg_busy
    with _encode_state:
        if priority:
            _user_encodes -= 1
        else:
            _bg_busy = False
        _encode_state.notify_all()


def song_id_for(source_path):
    key = f"{HLS_VERSION}:{os.path.basename(source_path)}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def hls_path(song_id, *parts):
    return os.path.join(HLS_DIR, song_id, *parts)


def variant_ready(song_id, name):
    return os.path.exists(hls_path(song_id, name, "playlist.m3u8"))


def lowest_ready(song_id):
    return variant_ready(song_id, VARIANTS[0]["name"]) and os.path.exists(hls_path(song_id, "master.m3u8"))


def hls_ready(song_id):
    return lowest_ready(song_id)


def _write_master_playlist(work_dir, ready_names=None):
    variants_by_name = {v["name"]: v for v in VARIANTS}
    names = ready_names if ready_names is not None else [
        name for name in MASTER_ORDER if os.path.exists(os.path.join(work_dir, name, "playlist.m3u8"))
    ]
    lines = ["#EXTM3U", "#EXT-X-VERSION:7"]

    for name in MASTER_ORDER:
        if name not in names:
            continue
        variant = variants_by_name[name]
        bandwidth = int(variant["bitrate"] * 1000 * 1.08)
        codec = "mp4a.40.5" if variant["bitrate"] <= 64 else "mp4a.40.2"
        lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},CODECS="{codec}"')
        lines.append(f"{name}/playlist.m3u8")

    if len(lines) <= 2:
        raise RuntimeError("no HLS variants ready for master playlist")

    with open(os.path.join(work_dir, "master.m3u8"), "w") as f:
        f.write("\n".join(lines) + "\n")


def _encode_variant(source_path, work_dir, variant):
    ff = ffmpeg_path()
    if not ff:
        raise RuntimeError("modern ffmpeg not available")

    variant_dir = os.path.join(work_dir, variant["name"])
    os.makedirs(variant_dir, exist_ok=True)

    profiles = [variant["profile"], "aac_he", "aac_low"]
    last_error = None

    for profile in profiles:
        cmd = [
            ff, "-y", "-loglevel", "error",
            "-i", source_path,
            "-vn",
            "-c:a", "aac",
            "-profile:a", profile,
            "-b:a", f"{variant['bitrate']}k",
            "-ac", "2",
            "-f", "hls",
            "-hls_time", str(SEGMENT_SECONDS),
            "-hls_playlist_type", "vod",
            "-hls_list_size", "0",
            "-hls_segment_type", "fmp4",
            "-hls_fmp4_init_filename", "init.mp4",
            "-hls_flags", "independent_segments",
            "-hls_segment_filename", os.path.join(variant_dir, "seg%04d.m4s"),
            os.path.join(variant_dir, "playlist.m3u8"),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and os.path.exists(os.path.join(variant_dir, "playlist.m3u8")):
            return
        last_error = (result.stderr or "").strip()
        print(f"HLS encode fallback for {variant['name']} profile {profile}: {last_error}")

    raise RuntimeError(f"ffmpeg failed for {variant['name']}: {last_error}")


def _missing_variants(song_id):
    return [variant for variant in VARIANTS if not variant_ready(song_id, variant["name"])]


def _encode_remaining(source_path):
    song_id = song_id_for(source_path)
    try:
        with _lock_for_song(song_id):
            missing = _missing_variants(song_id)
            if not missing:
                return
            _acquire_encode(False)
            try:
                out_dir = hls_path(song_id)
                os.makedirs(out_dir, exist_ok=True)
                for variant in missing:
                    if variant_ready(song_id, variant["name"]):
                        continue
                    print(f"Background HLS {variant['name']}: {os.path.basename(source_path)}")
                    _encode_variant(source_path, out_dir, variant)
                    _write_master_playlist(out_dir)
                print(f"HLS ladder complete: {song_id}")
            finally:
                _release_encode(False)
    except Exception as e:
        print(f"Background HLS failed for {os.path.basename(source_path)}: {e}")
    finally:
        with _song_locks_guard:
            _scheduled.discard(song_id)


def schedule_remaining(source_path):
    song_id = song_id_for(source_path)
    if not _missing_variants(song_id):
        return
    with _song_locks_guard:
        if song_id in _scheduled:
            return
        _scheduled.add(song_id)
    thread = threading.Thread(target=_encode_remaining, args=(source_path,), daemon=True)
    thread.start()


def build_hls(source_path, priority=True):
    song_id = song_id_for(source_path)
    if lowest_ready(song_id):
        schedule_remaining(source_path)
        return song_id

    with _lock_for_song(song_id):
        if lowest_ready(song_id):
            schedule_remaining(source_path)
            return song_id

        print(f"Transcoding lowest HLS rung: {os.path.basename(source_path)}")
        out_dir = hls_path(song_id)
        os.makedirs(out_dir, exist_ok=True)
        lowest = VARIANTS[0]
        _acquire_encode(priority)
        try:
            _encode_variant(source_path, out_dir, lowest)
            _write_master_playlist(out_dir)
            print(f"HLS playable: {song_id} ({lowest['name']})")
        except Exception:
            if not lowest_ready(song_id):
                shutil.rmtree(out_dir, ignore_errors=True)
            raise
        finally:
            _release_encode(priority)

    schedule_remaining(source_path)
    return song_id
