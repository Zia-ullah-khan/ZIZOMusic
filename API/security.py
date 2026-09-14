import hmac
import hashlib
import os
import re
import secrets
import threading
import time
import uuid
from collections import deque
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException, Request, WebSocket
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

SESSION_COOKIE = "session"
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
MEDIA_TTL_SECONDS = 2 * 60 * 60
MAX_SONG_NAME_LEN = 200
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
USER_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

DEFAULT_CORS_ORIGINS = [
    "https://zizomusic.com",
    "https://www.zizomusic.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

DEFAULT_ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "api.zizomusic.com",
    "zizomusic.com",
    "www.zizomusic.com",
    "10.0.2.2",
]

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


def _debug_enabled():
    return os.environ.get("ZIZO_DEBUG", "").lower() in ("1", "true", "yes")


def _load_secret():
    configured = os.environ.get("ZIZO_SECRET_KEY", "").strip()
    if configured:
        return configured.encode("utf-8")

    print("WARNING: ZIZO_SECRET_KEY unset, using ephemeral signing key")
    return secrets.token_bytes(32)


_SECRET = _load_secret()


def cors_origins():
    raw = os.environ.get("ZIZO_CORS_ORIGINS", "").strip()
    if not raw:
        return list(DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def allowed_hosts():
    raw = os.environ.get("ZIZO_ALLOWED_HOSTS", "").strip()
    if not raw:
        return list(DEFAULT_ALLOWED_HOSTS)
    return [host.strip() for host in raw.split(",") if host.strip()]


def is_valid_user_id(user_id):
    if not user_id or not USER_ID_PATTERN.match(user_id):
        return False
    try:
        UUID(user_id)
    except ValueError:
        return False
    return True


def require_valid_user_id(user_id):
    if not is_valid_user_id(user_id):
        raise ValueError("Invalid user_id")
    return user_id


def is_valid_video_id(video_id):
    return bool(video_id and VIDEO_ID_PATTERN.match(video_id))


def sanitize_song_name(song_name):
    if song_name is None:
        raise HTTPException(status_code=400, detail="song_name is required")
    cleaned = song_name.strip()
    if not cleaned or len(cleaned) > MAX_SONG_NAME_LEN:
        raise HTTPException(status_code=400, detail="Invalid song_name")
    return cleaned


def _sign(payload):
    return hmac.new(_SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _cookie_secure(request: Request):
    forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    scheme = forwarded or request.url.scheme
    host = (request.headers.get("host") or request.url.hostname or "").split(":")[0]
    if host in ("localhost", "127.0.0.1"):
        return False
    return scheme == "https"


def issue_session_token(user_id, ttl=SESSION_TTL_SECONDS):
    require_valid_user_id(user_id)
    exp = int(time.time()) + ttl
    return f"{user_id}.{exp}.{_sign(f'session:{user_id}:{exp}')}"


def parse_session_token(token):
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    user_id, exp_raw, sig = parts
    try:
        exp = int(exp_raw)
    except ValueError:
        return None
    if exp < int(time.time()):
        return None
    if not is_valid_user_id(user_id):
        return None
    expected = _sign(f"session:{user_id}:{exp}")
    if not hmac.compare_digest(expected, sig):
        return None
    return user_id


def issue_media_signature(resource, ttl=MEDIA_TTL_SECONDS):
    exp = int(time.time()) + ttl
    sig = _sign(f"media:{resource}:{exp}")
    return exp, sig


def verify_media_signature(resource, exp, sig):
    try:
        exp_int = int(exp)
    except (TypeError, ValueError):
        return False
    if not sig or exp_int < int(time.time()):
        return False
    expected = _sign(f"media:{resource}:{exp_int}")
    return hmac.compare_digest(expected, str(sig))


def signed_media_query(resource):
    exp, sig = issue_media_signature(resource)
    return f"exp={exp}&sig={sig}"


def signed_stream_path(song_name):
    query = signed_media_query(f"stream:{song_name}")
    return f"/stream/{quote(song_name)}?{query}"


def signed_hls_master_path(song_id):
    query = signed_media_query(f"hls:{song_id}")
    return f"/hls/{song_id}/master.m3u8?{query}"


def rewrite_m3u8(body, exp, sig):
    query = f"exp={exp}&sig={sig}"
    lines = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "?" in stripped:
            lines.append(line)
            continue
        lines.append(f"{stripped}?{query}")
    return "\n".join(lines) + "\n"


def session_from_request(request: Request):
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        user_id = parse_session_token(auth[7:].strip())
        if user_id:
            return user_id
    return parse_session_token(request.cookies.get(SESSION_COOKIE))


def session_from_websocket(websocket: WebSocket):
    token = websocket.query_params.get("token")
    user_id = parse_session_token(token)
    if user_id:
        return user_id
    auth = websocket.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        user_id = parse_session_token(auth[7:].strip())
        if user_id:
            return user_id
    return parse_session_token(websocket.cookies.get(SESSION_COOKIE))


def set_session_cookie(response: Response, token: str, request: Request):
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
        path="/",
    )


def client_ip(request: Request):
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimiter:
    def __init__(self):
        self._hits = {}
        self._lock = threading.Lock()

    def allow(self, key, limit, window_seconds):
        now = time.time()
        with self._lock:
            bucket = self._hits.get(key)
            if bucket is None:
                bucket = deque()
                self._hits[key] = bucket
            while bucket and now - bucket[0] > window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            if len(self._hits) > 4096:
                stale = [entry_key for entry_key, times in self._hits.items() if not times]
                for entry_key in stale:
                    self._hits.pop(entry_key, None)
            return True


rate_limiter = RateLimiter()


def enforce_rate_limit(request: Request, bucket, limit, window_seconds):
    key = f"{bucket}:{client_ip(request)}"
    if not rate_limiter.allow(key, limit, window_seconds):
        raise HTTPException(status_code=429, detail="Too many requests")


def require_session(request: Request):
    user_id = session_from_request(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user_id


def ensure_session(request: Request):
    user_id = session_from_request(request)
    if user_id:
        return user_id, None
    user_id = str(uuid.uuid4())
    return user_id, issue_session_token(user_id)


def attach_session_if_needed(response: Response, request: Request, token):
    if token:
        set_session_cookie(response, token, request)
    return response


def require_media_access(request: Request, resource):
    exp = request.query_params.get("exp")
    sig = request.query_params.get("sig")
    if verify_media_signature(resource, exp, sig):
        return
    if session_from_request(request):
        return
    raise HTTPException(status_code=401, detail="Unauthorized")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        if _cookie_secure(request):
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response
