import json
import os
import random
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from ytmusicapi import YTMusic

PROFILES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles")
# Set to an integer to cap saved history length, or None for unlimited
HISTORY_MAX = None

RADIO_SEED_COUNT = 3
RADIO_FETCH_LIMIT = 25
TOP_ARTIST_SEARCHES = 3
TOP_TAG_SEARCHES = 3
SEARCH_FETCH_LIMIT = 20
MAX_SONGS_PER_ARTIST = 3
FETCH_WORKERS = 4
FUNCTIONAL_HISTORY_MAX = 50
FUNCTIONAL_SESSION_TTL = 1800

FALLBACK_QUERIES = ["top hits", "trending songs", "popular music"]

BLOCKED_PATTERNS = re.compile(
    r"\b("
    r"sleep|deep\s*sleep|insomnia|bedtime|fall\s*asleep|"
    r"white\s*noise|pink\s*noise|brown\s*noise|green\s*noise|fan\s*noise|"
    r"binaural|binaural\s*beats|isochronic|delta\s*waves|theta\s*waves|"
    r"rain\s*sounds|thunderstorm|ocean\s*waves|ambient\s*noise|nature\s*sounds|"
    r"meditation|relaxing|relaxation|sound\s*therapy|healing\s*frequency|"
    r"432hz|528hz|solfeggio|study\s*noise|asmr|lullaby"
    r")\b",
    re.IGNORECASE
)


class RecommendationEngine:
    def __init__(self):
        self.ytmusic = YTMusic()
        self._profile_lock = threading.Lock()
        os.makedirs(PROFILES_DIR, exist_ok=True)
        try:
            os.chmod(PROFILES_DIR, 0o777)
        except OSError:
            pass
        print(f"Profiles directory: {PROFILES_DIR}")

    # ------------------------------------------------------------------
    # Normalization and filtering
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize(text):
        return text.strip().lower() if text else ""

    @classmethod
    def _track_key(cls, title, artist):
        return f"{cls._normalize(title)}|{cls._normalize(artist)}"

    @staticmethod
    def _is_functional(*texts):
        """Classifier for functional/ambient audio (sleep, noise, binaural, meditation, ASMR)."""
        for text in texts:
            if not text:
                continue
            if isinstance(text, (list, tuple)):
                if RecommendationEngine._is_functional(*text):
                    return True
            elif BLOCKED_PATTERNS.search(str(text)):
                return True
        return False

    def _extract_track(self, track, allow_functional=False):
        """Parse an upstream track into a clean payload, or None if invalid/filtered."""
        title = (track.get('title') or "").strip()
        artists = track.get('artists') or []
        artist = (artists[0].get('name') or "").strip() if artists else ""
        if not artist:
            artist = (track.get('artist') or "").strip()

        thumbnails = track.get('thumbnails') or track.get('thumbnail') or []
        thumbnail = thumbnails[-1].get('url', "") if thumbnails else ""

        if not title or not artist or not thumbnail:
            return None

        query = f"{title} {artist}".strip()
        if not allow_functional and self._is_functional(title, artist, query):
            return None

        return {
            "title": title,
            "artist": artist,
            "thumbnail": thumbnail,
            "query": query,
            "videoId": track.get('videoId') or ""
        }

    # ------------------------------------------------------------------
    # Profile persistence
    # ------------------------------------------------------------------

    def _get_profile_path(self, user_id):
        return os.path.join(PROFILES_DIR, f"{user_id}.json")

    @staticmethod
    def _empty_profile():
        return {
            "history": [],
            "functional_history": [],
            "tags": {},
            "artists": {},
            "played": {},
            "skips": {},
            "session": {}
        }

    def _load_profile(self, user_id):
        profile = self._empty_profile()
        path = self._get_profile_path(user_id)

        with self._profile_lock:
            if os.path.exists(path):
                try:
                    with open(path, "r") as f:
                        stored = json.load(f)
                    profile.update(stored)
                except (OSError, json.JSONDecodeError) as e:
                    print(f"Failed to load profile for {user_id}: {e}")

        return profile

    def _save_profile(self, user_id, profile):
        path = self._get_profile_path(user_id)

        with self._profile_lock:
            try:
                fd, temp_path = tempfile.mkstemp(dir=PROFILES_DIR, suffix=".tmp")
                try:
                    with os.fdopen(fd, "w") as f:
                        json.dump(profile, f, indent=2)
                    os.replace(temp_path, path)
                except BaseException:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                    raise

                try:
                    os.chmod(path, 0o666)
                except OSError:
                    pass
            except OSError as e:
                print(f"Failed to save profile for {user_id}: {e}")

    # ------------------------------------------------------------------
    # Profile updates
    # ------------------------------------------------------------------

    def update_profile(self, metadata, user_id, source="user"):
        print(f"Updating profile for user: {user_id} (source: {source})")
        if not metadata or not user_id:
            print("Missing metadata or user_id")
            return

        title = metadata.get('title')
        tags = metadata.get('tags') or []
        categories = metadata.get('categories') or []

        artist = metadata.get('artist') or metadata.get('uploader')
        if not artist and 'artists' in metadata:
            artists_list = metadata.get('artists', [])
            if artists_list:
                artist = artists_list[0].get('name')

        is_functional = self._is_functional(title, artist, metadata.get('uploader'), tags, categories)
        video_id = metadata.get('id') or metadata.get('videoId')
        now = int(time.time())

        if is_functional:
            if source == "autoplay":
                print(f"Quarantined autoplay functional audio: {title}")
                return

            profile = self._load_profile(user_id)
            if video_id:
                if video_id in profile['functional_history']:
                    profile['functional_history'].remove(video_id)
                profile['functional_history'].append(video_id)
                profile['functional_history'] = profile['functional_history'][-FUNCTIONAL_HISTORY_MAX:]

            title_key = self._normalize(title)
            if title_key:
                profile['played'][title_key] = now

            profile['session'] = {"functional": True, "updated": now}
            self._save_profile(user_id, profile)
            print(f"Recorded functional play in isolation: {title}")
            return

        profile = self._load_profile(user_id)

        if video_id:
            if video_id in profile['history']:
                profile['history'].remove(video_id)
            profile['history'].append(video_id)

            if HISTORY_MAX is not None and len(profile['history']) > HISTORY_MAX:
                profile['history'] = profile['history'][-HISTORY_MAX:]

        for tag in tags + categories:
            if tag:
                profile['tags'][tag] = profile['tags'].get(tag, 0) + 1

        if artist:
            profile['artists'][artist] = profile['artists'].get(artist, 0) + 1

        title_key = self._normalize(title)
        if title_key:
            profile['played'][title_key] = now

        profile['session'] = {"functional": False, "updated": now}
        self._save_profile(user_id, profile)

    def mark_skipped_or_disliked(self, track_id, user_id):
        """Record an early skip so the track stops seeding and re-entering the queue."""
        if not track_id or not user_id:
            return

        profile = self._load_profile(user_id)
        profile['skips'][self._normalize(str(track_id))] = int(time.time())

        if track_id in profile['history']:
            profile['history'].remove(track_id)
        if track_id in profile['functional_history']:
            profile['functional_history'].remove(track_id)

        self._save_profile(user_id, profile)
        print(f"Marked skipped: {track_id}")

    # ------------------------------------------------------------------
    # Candidate pool fetching (each fetcher is exception-safe)
    # ------------------------------------------------------------------

    def _get_top_items(self, item_dict, count=None):
        if not item_dict:
            return []
        sorted_items = sorted(item_dict.items(), key=lambda x: x[1], reverse=True)
        items = [item[0] for item in sorted_items]
        return items if count is None else items[:count]

    def _fetch_radio_seed(self, video_id, allow_functional=False):
        try:
            watch = self.ytmusic.get_watch_playlist(videoId=video_id, limit=RADIO_FETCH_LIMIT)
        except Exception as e:
            print(f"Radio fetch failed for {video_id}: {e}")
            return []

        pool = []
        for track in (watch.get('tracks') or [])[:RADIO_FETCH_LIMIT]:
            extracted = self._extract_track(track, allow_functional)
            if extracted:
                pool.append(extracted)
        return pool

    def _fetch_search(self, query, allow_functional=False):
        try:
            results = self.ytmusic.search(query=query, filter='songs', limit=SEARCH_FETCH_LIMIT)
        except Exception as e:
            print(f"Search failed for '{query}': {e}")
            return []

        pool = []
        for track in results or []:
            extracted = self._extract_track(track, allow_functional)
            if extracted:
                pool.append(extracted)
        return pool

    def _fetch_charts(self, needed):
        pool = []
        try:
            charts = self.ytmusic.get_charts(country='US')
            for section in ('songs', 'videos', 'trending'):
                items = charts.get(section)
                if isinstance(items, dict):
                    items = items.get('items')
                for track in items or []:
                    extracted = self._extract_track(track)
                    if extracted:
                        pool.append(extracted)
        except Exception as e:
            print(f"Charts fetch failed: {e}")

        for query in FALLBACK_QUERIES:
            if len(pool) >= needed:
                break
            pool.extend(self._fetch_search(query))
        return pool

    def _fetch_pools(self, profile, functional_session=False):
        """Fetch radio, artist, and tag candidate pools concurrently.

        In a functional session (user explicitly playing sleep/ambient audio), seeds come
        from the isolated functional history and functional candidates are allowed through.
        """
        pools = {"radio": [], "artist": [], "tag": []}
        tasks = []

        if functional_session:
            seeds = list(dict.fromkeys(reversed(profile['functional_history'])))[:RADIO_SEED_COUNT]
            tasks.extend(("radio", self._fetch_radio_seed, (seed, True)) for seed in seeds)
        else:
            seeds = list(dict.fromkeys(reversed(profile['history'])))[:RADIO_SEED_COUNT]
            top_artists = [a for a in self._get_top_items(profile['artists'], TOP_ARTIST_SEARCHES)
                           if not self._is_functional(a)]
            top_tags = [t for t in self._get_top_items(profile['tags'], TOP_TAG_SEARCHES)
                        if not self._is_functional(t)]

            tasks.extend(("radio", self._fetch_radio_seed, (seed,)) for seed in seeds)
            tasks.extend(("artist", self._fetch_search, (f"songs similar to {artist}",)) for artist in top_artists)
            tasks.extend(("tag", self._fetch_search, (f"{tag} songs",)) for tag in top_tags)

        if not tasks:
            return pools

        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
            futures = {executor.submit(fn, *args): pool_name for pool_name, fn, args in tasks}
            for future in as_completed(futures):
                pools[futures[future]].extend(future.result())

        return pools

    # ------------------------------------------------------------------
    # Merging and diversity
    # ------------------------------------------------------------------

    def _fill_round_robin(self, results, seen, per_artist, excluded, pools, limit):
        """Interleave pools round-robin, capping per-artist repeats and skipping excluded tracks.

        `excluded` holds normalized played titles, skipped keys, and skipped video ids.
        """
        active = [list(pool) for pool in pools if pool]
        positions = [0] * len(active)

        while active and len(results) < limit:
            exhausted = []
            for i, pool in enumerate(active):
                if len(results) >= limit:
                    break
                if positions[i] >= len(pool):
                    exhausted.append(i)
                    continue

                track = pool[positions[i]]
                positions[i] += 1

                key = self._track_key(track['title'], track['artist'])
                artist_key = self._normalize(track['artist'])
                if key in seen:
                    continue
                if (self._normalize(track['title']) in excluded or key in excluded
                        or self._normalize(track.get('videoId')) in excluded):
                    continue
                if per_artist.get(artist_key, 0) >= MAX_SONGS_PER_ARTIST:
                    continue

                seen.add(key)
                per_artist[artist_key] = per_artist.get(artist_key, 0) + 1
                results.append(track)

            for i in reversed(exhausted):
                del active[i]
                del positions[i]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @staticmethod
    def _is_functional_session(profile):
        session = profile.get('session') or {}
        if not session.get('functional'):
            return False
        return int(time.time()) - int(session.get('updated', 0)) <= FUNCTIONAL_SESSION_TTL

    def _build_excluded(self, profile):
        excluded = set(profile.get('played', {}))
        excluded.update(profile.get('skips', {}))
        excluded.discard("")
        return excluded

    def get_recommendations(self, user_id, limit=50):
        profile = self._load_profile(user_id) if user_id else self._empty_profile()

        excluded = self._build_excluded(profile)
        functional_session = self._is_functional_session(profile)
        pools = self._fetch_pools(profile, functional_session)

        for pool in pools.values():
            random.shuffle(pool)

        results = []
        seen = set()
        per_artist = {}
        self._fill_round_robin(results, seen, per_artist, excluded,
                               [pools["radio"], pools["artist"], pools["tag"]], limit)

        if len(results) < limit and not functional_session:
            charts_pool = self._fetch_charts(limit - len(results))
            self._fill_round_robin(results, seen, per_artist, excluded, [charts_pool], limit)

        return results

    def get_tag_based_recommendations(self, user_id, tag=None, limit=50):
        """Get recommendations based on a specific tag or all top tags if none specified."""
        if not user_id:
            return []

        profile = self._load_profile(user_id)
        excluded = self._build_excluded(profile)

        tags_to_search = [tag] if tag else self._get_top_items(profile['tags'])
        tags_to_search = [t for t in tags_to_search if t and not self._is_functional(t)]
        if not tags_to_search:
            return []

        pools = []
        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
            futures = [executor.submit(self._fetch_search, f"{t} songs") for t in tags_to_search]
            pools = [future.result() for future in futures]

        results = []
        self._fill_round_robin(results, set(), {}, excluded, pools, limit)
        return results

    def get_user_tags(self, user_id):
        """Get all tags for a user with their counts."""
        if not user_id:
            return {}
        profile = self._load_profile(user_id)
        return profile.get('tags', {})

    def get_user_artists(self, user_id):
        """Get all artists for a user with their play counts."""
        if not user_id:
            return {}
        profile = self._load_profile(user_id)
        return profile.get('artists', {})
