import json
import os
from ytmusicapi import YTMusic
from collections import Counter

PROFILES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profiles")

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
            print(f"Permission denied writing to {path}. Trying to fix permissions...")
            try:
                os.chmod(path, 0o666)
                with open(path, "w") as f:
                    json.dump(profile, f, indent=2)
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
            
            if len(profile['history']) > 50:
                profile['history'].pop(0)

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

    def get_recommendations(self, user_id, limit=10):
        if not user_id:
             return [
                {"title": "Top 100 songs", "artist": "Charts", "thumbnail": "", "query": "Top 100 songs"},
                {"title": "Trending music", "artist": "Charts", "thumbnail": "", "query": "Trending music"},
                {"title": "New releases", "artist": "Charts", "thumbnail": "", "query": "New releases"}
            ]

        profile = self._load_profile(user_id)
        recommendations = []
        
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
                        
                        if title:
                            recommendations.append({
                                "title": title,
                                "artist": artist_name,
                                "thumbnail": thumbnail_url,
                                "query": f"{title} {artist_name}"
                            })
            except Exception as e:
                print(f"Error getting watch playlist: {e}")

        if len(recommendations) < limit and profile['artists']:
            top_artist = max(profile['artists'], key=profile['artists'].get)
            try:
                results = self.ytmusic.search(query=f"songs similar to {top_artist}", filter='songs', limit=limit)
                for r in results:
                    title = r.get('title')
                    artists = r.get('artists', [])
                    artist_name = artists[0]['name'] if artists else ""
                    thumbnails = r.get('thumbnails', [])
                    thumbnail_url = thumbnails[-1]['url'] if thumbnails else ""
                    if not any(rec['title'] == title for rec in recommendations):
                        recommendations.append({
                            "title": title,
                            "artist": artist_name,
                            "thumbnail": thumbnail_url,
                            "query": f"{title} {artist_name}"
                        })
            except:
                pass
                
        if not recommendations:
            return [
                {"title": "Top 100 songs", "artist": "Charts", "thumbnail": "", "query": "Top 100 songs"},
                {"title": "Trending music", "artist": "Charts", "thumbnail": "", "query": "Trending music"},
                {"title": "New releases", "artist": "Charts", "thumbnail": "", "query": "New releases"}
            ]
            
        return recommendations[:limit]
