package com.zizomusic;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.utils.MediaConstants;
import com.doublesymmetry.trackplayer.model.Track;
import com.doublesymmetry.trackplayer.service.MusicService;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;

public class AutoMediaBrowserService extends MediaBrowserServiceCompat {
    private static final String TAG = "AutoMediaBrowserService";
    private static final String MEDIA_ROOT_ID = "zizo_root";
    private static final int MAX_RETRY_ATTEMPTS = 60;
    private static final long RETRY_DELAY_MS = 1000;
    private static final int ARTWORK_SIZE = 320;

    private Handler retryHandler;
    private int retryCount = 0;
    private MediaSessionCompat mediaSession;
    private MusicService musicService;
    private boolean bound = false;
    private String lastMetadataKey = "";
    private int lastQueueSize = -1;
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private String requestedArtworkUrl = "";
    private String loadedArtworkUrl = "";
    private Bitmap loadedArtwork;
    private String lastTitle = "ZIZO Music";
    private String lastArtist = "ZIZO Music";
    private String lastAlbum = "";
    private String lastMediaId = "zizo";
    private long lastDurationMs = 0;
    private String lastArtworkUrl = "";

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            Log.d(TAG, "Connected to MusicService");
            MusicService.MusicBinder binder = (MusicService.MusicBinder) service;
            musicService = binder.getService();
            bound = true;
            retryCount = 0;
            updateFromPlayer();
            notifyChildrenChanged(MEDIA_ROOT_ID);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            Log.d(TAG, "Disconnected from MusicService");
            bound = false;
            musicService = null;
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "AutoMediaBrowserService onCreate");
        retryHandler = new Handler(Looper.getMainLooper());
        createMediaSession();
        bindToMusicService();
    }

    private void runOnPlayerThread(Runnable action) {
        retryHandler.post(() -> {
            if (!bound || musicService == null) {
                Log.w(TAG, "Player command ignored; MusicService not bound");
                return;
            }
            try {
                action.run();
                updateFromPlayer();
            } catch (Exception e) {
                Log.e(TAG, "Player command failed", e);
            }
        });
    }

    private void createMediaSession() {
        mediaSession = new MediaSessionCompat(this, TAG);
        mediaSession.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS |
                MediaSessionCompat.FLAG_HANDLES_QUEUE_COMMANDS);

        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent != null) {
            PendingIntent sessionActivity = PendingIntent.getActivity(
                    this,
                    0,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            mediaSession.setSessionActivity(sessionActivity);
        }

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                Log.d(TAG, "onPlay");
                runOnPlayerThread(() -> musicService.play());
            }

            @Override
            public void onPause() {
                Log.d(TAG, "onPause");
                runOnPlayerThread(() -> musicService.pause());
            }

            @Override
            public void onSkipToNext() {
                Log.d(TAG, "onSkipToNext");
                runOnPlayerThread(() -> musicService.skipToNext());
            }

            @Override
            public void onSkipToPrevious() {
                Log.d(TAG, "onSkipToPrevious");
                runOnPlayerThread(() -> {
                    int index = musicService.getCurrentTrackIndex();
                    if (index > 0) {
                        musicService.skip(index - 1);
                    } else {
                        musicService.seekTo(0);
                    }
                });
            }

            @Override
            public void onSkipToQueueItem(long id) {
                Log.d(TAG, "onSkipToQueueItem: " + id);
                runOnPlayerThread(() -> musicService.skip((int) id));
            }

            @Override
            public void onPlayFromMediaId(String mediaId, Bundle extras) {
                Log.d(TAG, "onPlayFromMediaId: " + mediaId);
                runOnPlayerThread(() -> {
                    if (mediaId.startsWith("recent:")) {
                        String songName = mediaId.substring("recent:".length());
                        try {
                            List<Track> tracks = musicService.getTracks();
                            int foundIndex = -1;
                            for (int i = 0; i < tracks.size(); i++) {
                                String title = tracks.get(i).getTitle();
                                if (title != null && title.equalsIgnoreCase(songName)) {
                                    foundIndex = i;
                                    break;
                                }
                            }
                            if (foundIndex >= 0) {
                                musicService.skip(foundIndex);
                                musicService.play();
                            } else {
                                Log.w(TAG, "Recent track not found in player queue: " + songName);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error playing recent track", e);
                        }
                    } else {
                        int index = parseQueueIndex(mediaId);
                        if (index >= 0) {
                            musicService.skip(index);
                        }
                        musicService.play();
                    }
                });
            }

            @Override
            public void onStop() {
                Log.d(TAG, "onStop");
                runOnPlayerThread(() -> musicService.stop());
            }

            @Override
            public void onSeekTo(long pos) {
                Log.d(TAG, "onSeekTo: " + pos);
                runOnPlayerThread(() -> musicService.seekTo((float) (pos / 1000.0)));
            }

            @Override
            public void onFastForward() {
                runOnPlayerThread(() -> musicService.seekBy(10f));
            }

            @Override
            public void onRewind() {
                runOnPlayerThread(() -> musicService.seekBy(-10f));
            }
        });

        mediaSession.setActive(true);
        setSessionToken(mediaSession.getSessionToken());
        publishPlaceholderMetadata();
        startMetadataPolling();
    }

    private int parseQueueIndex(String mediaId) {
        if (mediaId == null) {
            return -1;
        }
        if (mediaId.startsWith("queue:")) {
            try {
                return Integer.parseInt(mediaId.substring("queue:".length()));
            } catch (NumberFormatException ignored) {
                return -1;
            }
        }
        return -1;
    }

    private void bindToMusicService() {
        Log.d(TAG, "Attempting to bind to MusicService");
        Intent intent = new Intent(this, MusicService.class);
        try {
            bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        } catch (Exception e) {
            Log.e(TAG, "Error binding to MusicService", e);
            scheduleRetry();
        }
    }

    private void startMetadataPolling() {
        retryHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!bound) {
                    bindToMusicService();
                }
                updateFromPlayer();
                retryHandler.postDelayed(this, 1000);
            }
        }, 500);
    }

    private void publishPlaceholderMetadata() {
        MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, "zizo")
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, "ZIZO Music")
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "Play a song on your phone")
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, "ZIZO Music")
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, "Play a song on your phone")
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, 0);
        mediaSession.setMetadata(builder.build());
        updatePlaybackState(PlaybackStateCompat.STATE_NONE, 0, 0, 0f);
    }

    private String firstNonEmpty(String... values) {
        if (values == null) {
            return "";
        }
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value;
            }
        }
        return "";
    }

    private String bundleString(android.os.Bundle bundle, String key) {
        if (bundle == null) {
            return "";
        }
        String value = bundle.getString(key);
        return value == null ? "" : value;
    }

    private void updateFromPlayer() {
        if (!bound || musicService == null || mediaSession == null) {
            return;
        }

        try {
            List<Track> tracks = musicService.getTracks();
            int index = 0;
            try {
                index = musicService.getCurrentTrackIndex();
            } catch (Exception ignored) {}

            if (tracks == null || tracks.isEmpty() || index < 0 || index >= tracks.size()) {
                return;
            }

            Track currentTrack = tracks.get(index);
            android.os.Bundle original = currentTrack.getOriginalItem();
            String title = firstNonEmpty(
                    currentTrack.getTitle(),
                    bundleString(original, "title"),
                    "ZIZO Music");
            String artist = firstNonEmpty(
                    currentTrack.getArtist(),
                    bundleString(original, "artist"),
                    "ZIZO Music");
            String album = firstNonEmpty(currentTrack.getAlbum(), bundleString(original, "album"));
            android.net.Uri artworkUri = currentTrack.getArtwork();
            Long trackDurationMs = currentTrack.getDuration();

            long durationMs = 0;
            try {
                durationMs = (long) (musicService.getDurationInSeconds() * 1000.0);
            } catch (Exception ignored) {}
            if (durationMs <= 0 && trackDurationMs != null) {
                durationMs = trackDurationMs;
            }

            String mediaId = "queue:" + index;
            String artworkUrl = "";
            if (artworkUri != null) {
                artworkUrl = artworkUri.toString();
            }
            if (artworkUrl.isEmpty()) {
                artworkUrl = bundleString(original, "artwork");
            }

            lastTitle = title;
            lastArtist = artist;
            lastAlbum = album;
            lastMediaId = mediaId;
            lastDurationMs = Math.max(durationMs, 0);
            lastArtworkUrl = artworkUrl;

            String metadataKey = mediaId + "|" + title + "|" + artist + "|" + lastDurationMs + "|" + artworkUrl;
            boolean needsPublish = !metadataKey.equals(lastMetadataKey);
            boolean needsArtwork = !artworkUrl.isEmpty() && !artworkUrl.equals(loadedArtworkUrl);
            if (needsPublish) {
                lastMetadataKey = metadataKey;
                publishCurrentMetadata();
            }
            if (needsArtwork) {
                requestArtwork(artworkUrl);
            }

            if (tracks.size() != lastQueueSize) {
                lastQueueSize = tracks.size();
                publishQueue(tracks);
                notifyChildrenChanged(MEDIA_ROOT_ID);
            }

            int playbackState = PlaybackStateCompat.STATE_PAUSED;
            float speed = 0f;
            try {
                if (musicService.getPlayWhenReady()) {
                    playbackState = PlaybackStateCompat.STATE_PLAYING;
                    speed = 1.0f;
                }
            } catch (Exception e) {
                Log.w(TAG, "Error getting playback state", e);
            }

            long position = 0;
            try {
                position = (long) (musicService.getPositionInSeconds() * 1000);
            } catch (Exception ignored) {}

            updatePlaybackState(playbackState, position, index, speed);
        } catch (Exception e) {
            Log.e(TAG, "Error updating metadata", e);
        }
    }

    private void publishCurrentMetadata() {
        if (mediaSession == null) {
            return;
        }

        MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, lastMediaId)
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, lastTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, lastArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, lastTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, lastArtist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, lastDurationMs);

        if (!lastAlbum.isEmpty()) {
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, lastAlbum);
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, lastAlbum);
        }

        if (!lastArtworkUrl.isEmpty() && lastArtworkUrl.equals(loadedArtworkUrl)) {
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, lastArtworkUrl);
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ART_URI, lastArtworkUrl);
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, lastArtworkUrl);
        }

        if (loadedArtwork != null && !loadedArtwork.isRecycled()) {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, loadedArtwork);
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, loadedArtwork);
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, loadedArtwork);
        }

        mediaSession.setMetadata(metadataBuilder.build());
        Log.d(TAG, "Published Auto metadata: " + lastTitle + " / " + lastArtist +
                " duration=" + lastDurationMs + " art=" + (loadedArtwork != null));
    }

    private void requestArtwork(String artworkUrl) {
        requestedArtworkUrl = artworkUrl;
        artworkExecutor.execute(() -> {
            Bitmap bitmap = downloadArtwork(artworkUrl);
            retryHandler.post(() -> {
                if (!artworkUrl.equals(requestedArtworkUrl) || !artworkUrl.equals(lastArtworkUrl)) {
                    if (bitmap != null && !bitmap.isRecycled()) {
                        bitmap.recycle();
                    }
                    return;
                }
                if (bitmap == null) {
                    Log.w(TAG, "Keeping previous Auto artwork; download failed");
                    return;
                }
                Bitmap previous = loadedArtwork;
                loadedArtwork = bitmap;
                loadedArtworkUrl = artworkUrl;
                publishCurrentMetadata();
                if (previous != null && previous != bitmap && !previous.isRecycled()) {
                    previous.recycle();
                }
            });
        });
    }

    private Bitmap downloadArtwork(String artworkUrl) {
        HttpURLConnection connection = null;
        InputStream inputStream = null;
        try {
            URL url = new URL(artworkUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setRequestProperty("User-Agent", "ZizoMusic/1.0");
            connection.connect();
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "Artwork download failed: " + connection.getResponseCode());
                return null;
            }
            inputStream = connection.getInputStream();
            Bitmap decoded = BitmapFactory.decodeStream(inputStream);
            if (decoded == null) {
                return null;
            }
            int width = decoded.getWidth();
            int height = decoded.getHeight();
            int longest = Math.max(width, height);
            if (longest > ARTWORK_SIZE) {
                float scale = ARTWORK_SIZE / (float) longest;
                Bitmap scaled = Bitmap.createScaledBitmap(
                        decoded,
                        Math.max(1, Math.round(width * scale)),
                        Math.max(1, Math.round(height * scale)),
                        true);
                if (scaled != decoded) {
                    decoded.recycle();
                }
                return scaled;
            }
            return decoded;
        } catch (Exception e) {
            Log.w(TAG, "Artwork download error", e);
            return null;
        } finally {
            if (inputStream != null) {
                try {
                    inputStream.close();
                } catch (Exception ignored) {}
            }
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void publishQueue(List<Track> tracks) {
        List<MediaSessionCompat.QueueItem> queue = new ArrayList<>();
        for (int i = 0; i < tracks.size(); i++) {
            Track track = tracks.get(i);
            String title = firstNonEmpty(track.getTitle(), "Track " + (i + 1));
            String artist = firstNonEmpty(track.getArtist(), "ZIZO Music");
            MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
                    .setMediaId("queue:" + i)
                    .setTitle(title)
                    .setSubtitle(artist)
                    .setIconUri(track.getArtwork())
                    .build();
            queue.add(new MediaSessionCompat.QueueItem(desc, i));
        }
        mediaSession.setQueue(queue);
        mediaSession.setQueueTitle("Now Playing");
    }

    private void updatePlaybackState(int state, long position, long activeQueueId, float speed) {
        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                .setActions(
                        PlaybackStateCompat.ACTION_PLAY |
                        PlaybackStateCompat.ACTION_PAUSE |
                        PlaybackStateCompat.ACTION_PLAY_PAUSE |
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                        PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM |
                        PlaybackStateCompat.ACTION_STOP |
                        PlaybackStateCompat.ACTION_SEEK_TO |
                        PlaybackStateCompat.ACTION_FAST_FORWARD |
                        PlaybackStateCompat.ACTION_REWIND)
                .setActiveQueueItemId(activeQueueId)
                .setState(state, position, speed, SystemClock.elapsedRealtime());

        mediaSession.setPlaybackState(stateBuilder.build());
    }

    private void scheduleRetry() {
        if (retryCount < MAX_RETRY_ATTEMPTS) {
            retryCount++;
            Log.d(TAG, "Scheduling retry " + retryCount);
            retryHandler.postDelayed(this::bindToMusicService, RETRY_DELAY_MS);
        }
    }

    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        Log.d(TAG, "onGetRoot called by: " + clientPackageName);
        Bundle extras = new Bundle();
        extras.putInt(
                MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,
                MediaConstants.DESCRIPTION_EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM);
        extras.putInt(
                MediaConstants.DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                MediaConstants.DESCRIPTION_EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM);
        extras.putBoolean(MediaConstants.BROWSER_SERVICE_EXTRAS_KEY_SEARCH_SUPPORTED, false);
        return new BrowserRoot(MEDIA_ROOT_ID, extras);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        Log.d(TAG, "onLoadChildren called for parentId: " + parentId);
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();

        if (MEDIA_ROOT_ID.equals(parentId)) {
            // Root categories (Folders)
            MediaDescriptionCompat recentsDesc = new MediaDescriptionCompat.Builder()
                    .setMediaId("folder_recent")
                    .setTitle("Recently Played")
                    .setSubtitle("Browse recently played songs")
                    .build();
            items.add(new MediaBrowserCompat.MediaItem(recentsDesc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE));

            MediaDescriptionCompat queueDesc = new MediaDescriptionCompat.Builder()
                    .setMediaId("folder_queue")
                    .setTitle("Up Next")
                    .setSubtitle("Browse active playback queue")
                    .build();
            items.add(new MediaBrowserCompat.MediaItem(queueDesc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE));
            
            result.sendResult(items);
            return;
        }

        if ("folder_queue".equals(parentId) && bound && musicService != null) {
            try {
                List<Track> tracks = musicService.getTracks();
                int startIndex = 0;
                try {
                    startIndex = musicService.getCurrentTrackIndex();
                    if (startIndex < 0) startIndex = 0;
                } catch (Exception ignored) {}

                for (int i = startIndex; i < tracks.size(); i++) {
                    Track track = tracks.get(i);
                    String title = firstNonEmpty(track.getTitle(), "Track " + (i + 1));
                    String artist = firstNonEmpty(track.getArtist(), "ZIZO Music");
                    MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
                            .setMediaId("queue:" + i)
                            .setTitle(title)
                            .setSubtitle(artist)
                            .setIconUri(track.getArtwork())
                            .build();
                    items.add(new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
                }
            } catch (Exception e) {
                Log.e(TAG, "Error loading queue children", e);
            }
            result.sendResult(items);
            return;
        }

        if ("folder_recent".equals(parentId)) {
            List<String> recents = getRecentSongsFromStorage();
            for (int i = 0; i < recents.size(); i++) {
                String songName = recents.get(i);
                MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
                        .setMediaId("recent:" + songName)
                        .setTitle(songName)
                        .setSubtitle("ZIZO Music")
                        .build();
                items.add(new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
            }
            result.sendResult(items);
            return;
        }

        if (items.isEmpty()) {
            MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
                    .setMediaId("now_playing")
                    .setTitle("ZIZO Music")
                    .setSubtitle("Play a song on your phone")
                    .build();
            items.add(new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
        }

        result.sendResult(items);
    }

    private List<String> getRecentSongsFromStorage() {
        List<String> list = new ArrayList<>();
        SQLiteDatabase db = null;
        Cursor cursor = null;
        try {
            db = openOrCreateDatabase("RKStorage", MODE_PRIVATE, null);
            cursor = db.rawQuery("SELECT value FROM catalystLocalStorage WHERE key = ?", new String[]{"recentSongs"});
            if (cursor != null && cursor.moveToFirst()) {
                String jsonStr = cursor.getString(0);
                if (jsonStr != null && !jsonStr.isEmpty()) {
                    JSONArray array = new JSONArray(jsonStr);
                    for (int i = 0; i < array.length(); i++) {
                        list.add(array.getString(i));
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reading recentSongs from RKStorage", e);
        } finally {
            if (cursor != null) cursor.close();
            if (db != null) db.close();
        }
        return list;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "AutoMediaBrowserService onDestroy");
        if (retryHandler != null) {
            retryHandler.removeCallbacksAndMessages(null);
        }
        artworkExecutor.shutdownNow();
        if (loadedArtwork != null && !loadedArtwork.isRecycled()) {
            loadedArtwork.recycle();
            loadedArtwork = null;
        }
        if (bound) {
            unbindService(serviceConnection);
            bound = false;
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }
}
