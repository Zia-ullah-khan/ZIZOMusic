import hashlib
import os
import shutil
import subprocess
import threading
from ffmpeg_bin import ffmpeg_available, ffmpeg_path

HLS_DIR = "./hls"
SEGMENT_SECONDS = 4

VARIANTS = [
    {"name": "v64", "bitrate": 64},
    {"name": "v128", "bitrate": 128},
    {"name": "v192", "bitrate": 192},
    {"name": "v256", "bitrate": 256},
]

# First entry is the rendition players start with before they know the bandwidth
MASTER_ORDER = ["v128", "v64", "v192", "v256"]

os.makedirs(HLS_DIR, exist_ok=True)

_song_locks = {}
_song_locks_guard = threading.Lock()


def _lock_for_song(song_id):
    with _song_locks_guard:
        lock = _song_locks.get(song_id)
        if lock is None:
            lock = threading.Lock()
            _song_locks[song_id] = lock
        return lock


def song_id_for(source_path):
    return hashlib.sha1(os.path.basename(source_path).encode("utf-8")).hexdigest()[:16]


def hls_ready(song_id):
    return os.path.exists(os.path.join(HLS_DIR, song_id, "master.m3u8"))


def hls_path(song_id, *parts):
    return os.path.join(HLS_DIR, song_id, *parts)


def build_hls(source_path):
    song_id = song_id_for(source_path)
    if hls_ready(song_id):
        return song_id

    with _lock_for_song(song_id):
        if hls_ready(song_id):
            return song_id

        print(f"Transcoding to HLS: {os.path.basename(source_path)}")
        out_dir = hls_path(song_id)
        work_dir = out_dir + ".tmp"
        shutil.rmtree(work_dir, ignore_errors=True)
        os.makedirs(work_dir)

        try:
            _encode_all_variants(source_path, work_dir)
            _write_master_playlist(work_dir)
            shutil.rmtree(out_dir, ignore_errors=True)
            os.replace(work_dir, out_dir)
            print(f"HLS ready: {song_id}")
            return song_id
        except Exception:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise


def _encode_all_variants(source_path, work_dir):
    processes = []

    for variant in VARIANTS:
        variant_dir = os.path.join(work_dir, variant["name"])
        os.makedirs(variant_dir)

        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", source_path,
            "-vn",
            "-c:a", "aac",
            "-b:a", f"{variant['bitrate']}k",
            "-ac", "2",
            "-f", "hls",
            "-hls_time", str(SEGMENT_SECONDS),
            "-hls_playlist_type", "vod",
            "-hls_list_size", "0",
            "-hls_flags", "independent_segments",
            "-hls_segment_filename", os.path.join(variant_dir, "seg%04d.ts"),
            os.path.join(variant_dir, "playlist.m3u8"),
        ]

        processes.append((variant["name"], subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)))

    failures = []
    for name, proc in processes:
        _, stderr = proc.communicate()
        if proc.returncode != 0:
            failures.append(f"{name}: {stderr.decode(errors='ignore').strip()}")

    if failures:
        raise RuntimeError("ffmpeg failed: " + "; ".join(failures))


def _write_master_playlist(work_dir):
    variants_by_name = {v["name"]: v for v in VARIANTS}
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]

    for name in MASTER_ORDER:
        variant = variants_by_name[name]
        bandwidth = int(variant["bitrate"] * 1000 * 1.15)
        lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},CODECS="mp4a.40.2"')
        lines.append(f"{name}/playlist.m3u8")

    with open(os.path.join(work_dir, "master.m3u8"), "w") as f:
        f.write("\n".join(lines) + "\n")
