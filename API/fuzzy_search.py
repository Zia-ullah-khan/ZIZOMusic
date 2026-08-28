from rapidfuzz import fuzz

VARIANT_TERMS = (
    "remix", "cover", "live", "acoustic", "sped up", "slowed",
    "reverb", "nightcore", "8d", "instrumental", "karaoke", "mashup",
)

RANK_BONUS_STEP = 0.015
PREFIX_BONUS = 0.05
SUGGESTION_BONUS_WEIGHT = 0.08
MAX_VARIANT_PENALTY = 0.3


def variant_penalty(query_lower, text_lower):
    penalty = 0.0
    for term in VARIANT_TERMS:
        if term in text_lower and term not in query_lower:
            penalty += 0.12
    return min(penalty, MAX_VARIANT_PENALTY)


def suggestion_text_bonus(combined, suggestion_texts):
    if not suggestion_texts:
        return 0.0
    best = max(fuzz.token_set_ratio(combined, text) for text in suggestion_texts)
    return SUGGESTION_BONUS_WEIGHT * (best / 100.0)


def score_candidate(query, title, artist, rank, suggestion_texts):
    query_lower = query.lower()
    title_lower = title.lower()
    combined = f"{title} {artist}".strip()

    base = (
        0.5 * fuzz.WRatio(query, combined)
        + 0.3 * fuzz.token_sort_ratio(query, combined)
        + 0.2 * fuzz.partial_ratio(query_lower, title_lower)
    ) / 100.0

    score = base
    score += RANK_BONUS_STEP * max(0, 5 - rank)
    if title_lower.startswith(query_lower):
        score += PREFIX_BONUS
    score += suggestion_text_bonus(combined, suggestion_texts)
    score -= variant_penalty(query_lower, combined.lower())

    return max(0.0, min(1.0, score))


def primary_artist(track):
    artists = track.get("artists") or []
    return artists[0].get("name", "") if artists else ""


def build_suggestion(track, score):
    thumbnails = track.get("thumbnails") or []
    return {
        "id": track.get("videoId", ""),
        "title": track.get("title", ""),
        "artist": primary_artist(track),
        "thumbnail": thumbnails[-1].get("url", "") if thumbnails else "",
        "duration": track.get("duration") or "",
        "score": round(score, 3),
    }


def rank_suggestions(query, results, suggestion_texts, limit):
    ranked = []
    seen = set()

    for rank, track in enumerate(results or []):
        video_id = track.get("videoId")
        if not video_id or video_id in seen:
            continue
        seen.add(video_id)

        score = score_candidate(query, track.get("title", ""), primary_artist(track), rank, suggestion_texts)
        ranked.append(build_suggestion(track, score))

    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked[:limit]
