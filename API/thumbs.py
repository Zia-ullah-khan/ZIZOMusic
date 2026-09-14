import re

_SIZE_IN_PATH = re.compile(r"=s(\d+)")
_SIZE_QUERY = re.compile(r"([?&](?:w|h|width|height|s))=(\d+)", re.IGNORECASE)
_GOOGLE_EQ = re.compile(r"=(?:w\d+(?:-h\d+)?|s\d+)(?:-[a-z0-9]+)*$", re.IGNORECASE)


def shrink_thumb_url(url, size=120):
    if not url or not isinstance(url, str):
        return ""
    if not url.startswith("https://") and not url.startswith("http://"):
        return ""

    if _GOOGLE_EQ.search(url):
        return _GOOGLE_EQ.sub(f"=w{size}-h{size}", url)

    if "googleusercontent.com" in url or "ggpht.com" in url or "ytimg.com" in url:
        if "=" in url.rsplit("/", 1)[-1]:
            return url
        return f"{url}=w{size}-h{size}"

    return url


def pick_thumbnail(thumbnails, min_size=120):
    if not thumbnails:
        return ""

    if isinstance(thumbnails, str):
        return shrink_thumb_url(thumbnails, min_size)

    sized = []
    for item in thumbnails:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or ""
        if not url:
            continue
        width = item.get("width") or 0
        height = item.get("height") or 0
        sized.append((max(int(width), int(height)), url))

    if not sized:
        return ""

    sized.sort(key=lambda pair: pair[0])
    for edge, url in sized:
        if edge >= min_size:
            return shrink_thumb_url(url, min_size)

    return shrink_thumb_url(sized[-1][1], min_size)
