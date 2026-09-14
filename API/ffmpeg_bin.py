import shutil
import subprocess

_ffmpeg_path = None
_ffmpeg_checked = False


def _is_modern(path):
    if not path:
        return False
    try:
        result = subprocess.run(
            [path, "-hide_banner", "-version"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        return result.returncode == 0
    except Exception:
        return False


def ffmpeg_path():
    global _ffmpeg_path, _ffmpeg_checked
    if _ffmpeg_checked:
        return _ffmpeg_path

    _ffmpeg_checked = True
    candidates = []

    try:
        import imageio_ffmpeg
        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled:
            candidates.append(bundled)
    except Exception:
        pass

    which = shutil.which("ffmpeg")
    if which:
        candidates.append(which)

    for candidate in candidates:
        if _is_modern(candidate):
            _ffmpeg_path = candidate
            print(f"Using ffmpeg: {candidate}")
            return _ffmpeg_path

    _ffmpeg_path = None
    print("WARNING: no modern ffmpeg found, HLS transcoding disabled")
    return None


def ffmpeg_available():
    return ffmpeg_path() is not None
