import json
import os
from ytmusicapi import YTMusic
from collections import Counter

PROFILES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles")
# Set to an integer to cap saved history length, or None for unlimited
HISTORY_MAX = None

class RecommendationEngine:
    def __init__(self):
        self.ytmusic = YTMusic()
        os.makedirs(PROFILES_DIR, exist_ok=True)
        try:
            os.chmod(PROFILES_DIR, 0o777)
        except:
            pass
        print(f"Profiles directory: {PROFILES_DIR}")

    def _get_profile_path(self, user_id):
        return os.path.join(PROFILES_DIR, f"{user_id}.json")

    def _load_profile(self, user_id):
        path = self._get_profile_path(user_id)
        if os.path.exists(path):
            try:
                with open(path, "r") as f:
                    return json.load(f)
            except:
                pass
        return {"history": [], "tags": {}, "artists": {}}

    def _save_profile(self, user_id, profile):
        path = self._get_profile_path(user_id)
        try:
            with open(path, "w") as f:
                json.dump(profile, f, indent=2)
            try:
                os.chmod(path, 0o666)
            except:
                pass
        except PermissionError:
            print(f"Permission denied writing to {path}. Attempting to recreate file...")
            try:
                if os.path.exists(path):
                    os.remove(path)
                
                with open(path, "w") as f:
                    json.dump(profile, f, indent=2)
                
                try:
                    os.chmod(path, 0o666)
                except:
                    pass
            except Exception as e:
                print(f"Failed to save profile for {user_id}: {e}")
        except Exception as e:
            print(f"Error saving profile: {e}")

    def update_profile(self, metadata, user_id):
        print(f"Updating profile for user: {user_id}")
        if not metadata or not user_id:
            print("Missing metadata or user_id")
            return

        profile = self._load_profile(user_id)

        video_id = metadata.get('id') or metadata.get('videoId')
        if video_id:
            if video_id in profile['history']:
                profile['history'].remove(video_id)
            profile['history'].append(video_id)

            # Trim history only if HISTORY_MAX is set (None => unlimited)
            if HISTORY_MAX is not None and len(profile['history']) > HISTORY_MAX:
                profile['history'] = profile['history'][-HISTORY_MAX:]

        tags = metadata.get('tags') or []
        categories = metadata.get('categories') or []
        all_tags = tags + categories
        
        for tag in all_tags:
            if tag:
                profile['tags'][tag] = profile['tags'].get(tag, 0) + 1

        artist = metadata.get('artist') or metadata.get('uploader')
        if not artist and 'artists' in metadata:
            artists_list = metadata.get('artists', [])
            if artists_list:
                artist = artists_list[0].get('name')

        if artist:
            profile['artists'][artist] = profile['artists'].get(artist, 0) + 1
            
        self._save_profile(user_id, profile)

    def _get_top_items(self, item_dict, count=None):
        """Get top items from a dictionary sorted by value (count). Returns all if count is None."""
        if not item_dict:
            return []
        sorted_items = sorted(item_dict.items(), key=lambda x: x[1], reverse=True)
        if count is None:
            return [item[0] for item in sorted_items]
        return [item[0] for item in sorted_items[:count]]

    def _add_recommendation(self, recommendations, title, artist_name, thumbnail_url, seen_titles):
        """Helper to add a recommendation if it's not a duplicate."""
        if title and title not in seen_titles:
            seen_titles.add(title)
            recommendations.append({
                "title": title,
                "artist": artist_name,
                "thumbnail": thumbnail_url,
                "query": f"{title} {artist_name}"
            })
            return True
        return False

    def get_recommendations(self, user_id, limit=50):
        if not user_id:
             return [
                {"title": "Top 100 songs", "artist": "Charts", "thumbnail": "", "query": "Top 100 songs"},
                {"title": "Trending music", "artist": "Charts", "thumbnail": "", "query": "Trending music"},
                {"title": "New releases", "artist": "Charts", "thumbnail": "", "query": "New releases"}
            ]

        profile = self._load_profile(user_id)
        recommendations = []
        seen_titles = set()
        per_query_limit = min(max(5, limit), 200)
        
        if profile['history']:
            last_id = profile['history'][-1]
            try:
                watch_playlist = self.ytmusic.get_watch_playlist(videoId=last_id, limit=limit)
                if 'tracks' in watch_playlist:
                    for track in watch_playlist['tracks']:
                        title = track.get('title')
                        artists = track.get('artists', [])
                        artist_name = artists[0]['name'] if artists else ""
                        thumbnails = track.get('thumbnail', [])
                        thumbnail_url = thumbnails[-1]['url'] if thumbnails else ""
                        self._add_recommendation(recommendations, title, artist_name, thumbnail_url, seen_titles)
            except Exception as e:
                print(f"Error getting watch playlist: {e}")

        if len(recommendations) < limit and profile['tags']:
            top_tags = self._get_top_items(profile['tags'])
            for tag in top_tags:
                if len(recommendations) >= limit:
                    break
                try:
                    results = self.ytmusic.search(query=f"{tag} music", filter='songs', limit=per_query_limit)
                    for r in results:
                        if len(recommendations) >= limit:
                            break
                        title = r.get('title')
                        artists = r.get('artists', [])
                        artist_name = artists[0]['name'] if artists else ""
                        thumbnails = r.get('thumbnails', [])
                        thumbnail_url = thumbnails[-1]['url'] if thumbnails else ""
                        self._add_recommendation(recommendations, title, artist_name, thumbnail_url, seen_titles)
                except Exception as e:
                    print(f"Error searching for tag '{tag}': {e}")

        if len(recommendations) < limit and profile['artists']:
            top_artists = self._get_top_items(profile['artists'])
            for artist in top_artists:
                if len(recommendations) >= limit:
                    break
                try:
                    results = self.ytmusic.search(query=f"songs similar to {artist}", filter='songs', limit=per_query_limit)
                    for r in results:
                        if len(recommendations) >= limit:
                            break
                        title = r.get('title')
                        artists = r.get('artists', [])
                        artist_name = artists[0]['name'] if artists else ""
                        thumbnails = r.get('thumbnails', [])
                        thumbnail_url = thumbnails[-1]['url'] if thumbnails else ""
                        self._add_recommendation(recommendations, title, artist_name, thumbnail_url, seen_titles)
                except Exception as e:
                    print(f"Error searching for artist '{artist}': {e}")

        if len(recommendations) < limit and (profile['tags'] or profile['artists']):
            top_tags = self._get_top_items(profile['tags'], 3)
            top_artists = self._get_top_items(profile['artists'], 3)

            for tag in top_tags:
                for artist in top_artists:
                    if len(recommendations) >= limit:
                        break
                    try:
                        results = self.ytmusic.search(query=f"{artist} {tag}", filter='songs', limit=per_query_limit)
                        for r in results:
                            if len(recommendations) >= limit:
                                break
                            title = r.get('title')
                            artists = r.get('artists', [])
                            artist_name = artists[0]['name'] if artists else ""
                            thumbnails = r.get('thumbnails', [])
                            thumbnail_url = thumbnails[-1]['url'] if thumbnails else ""
                            self._add_recommendation(recommendations, title, artist_name, thumbnail_url, seen_titles)
                    except Exception as e:
                        print(f"Error searching for '{artist} {tag}': {e}")
                
        if not recommendations:
            return [
                {"title": "Top 100 songs", "artist": "Charts", "thumbnail": "", "query": "Top 100 songs"},
                {"title": "Trending music", "artist": "Charts", "thumbnail": "", "query": "Trending music"},
                {"title": "New releases", "artist": "Charts", "thumbnail": "", "query": "New releases"}
            ]
            
        return recommendations[:limit]
    
    def get_tag_based_recommendations(self, user_id, tag=None, limit=50):
        """Get recommendations based on a specific tag or all tags if none specified."""
        if not user_id:
            return []
        
        profile = self._load_profile(user_id)
        recommendations = []
        seen_titles = set()
        
        if tag:
            tags_to_search = [tag]
        else:
            tags_to_search = self._get_top_items(profile['tags'])
        
        # per-search fetch size so we can return larger totals
        per_query_limit = min(max(5, limit), 200)

        for search_tag in tags_to_search:
            if len(recommendations) >= limit:
                break
            try:
                results = self.ytmusic.search(query=f"{search_tag} music", filter='songs', limit=per_query_limit)
                for r in results:
                    if len(recommendations) >= limit:
                        break
                    title = r.get('title')
                    artists = r.get('artists', [])
                    artist_name = artists[0]['name'] if artists else ""
                    thumbnails = r.get('thumbnails', [])
                    thumbnail_url = thumbnails[-1]['url'] if thumbnails else ""
                    self._add_recommendation(recommendations, title, artist_name, thumbnail_url, seen_titles)
            except Exception as e:
                print(f"Error searching for tag '{search_tag}': {e}")
        
        return recommendations[:limit]
    
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
