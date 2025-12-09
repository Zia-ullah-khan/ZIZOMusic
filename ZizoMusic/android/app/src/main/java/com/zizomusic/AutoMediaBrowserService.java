package com.zizomusic;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaControllerCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media.MediaBrowserServiceCompat;
import java.util.ArrayList;
import java.util.List;

public class AutoMediaBrowserService extends MediaBrowserServiceCompat {
    private static final String TAG = "AutoMediaBrowserService";
    private static final String MEDIA_ROOT_ID = "zizo_root";
    private static final int MAX_RETRY_ATTEMPTS = 60;
    private static final long RETRY_DELAY_MS = 1000;

    private Handler retryHandler;
    private int retryCount = 0;
    private MediaSessionCompat mediaSession;
    private com.doublesymmetry.trackplayer.service.MusicService musicService;
    private boolean bound = false;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            Log.d(TAG, "Connected to MusicService");
            com.doublesymmetry.trackplayer.service.MusicService.MusicBinder binder = 
                (com.doublesymmetry.trackplayer.service.MusicService.MusicBinder) service;
            musicService = binder.getService();
            bound = true;
            // MusicService is connected, now create our media session
            setupMediaSession();
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
        
        // Create media session immediately
        createMediaSession();
        
        // Try to bind to MusicService
        bindToMusicService();
    }

    private void createMediaSession() {
        Log.d(TAG, "Creating media session");
        mediaSession = new MediaSessionCompat(this, TAG);
        mediaSession.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                Log.d(TAG, "onPlay");
                if (bound && musicService != null) {
                    try {
                        musicService.play();
                        updatePlaybackState(PlaybackStateCompat.STATE_PLAYING);
                    } catch (Exception e) {
                        Log.e(TAG, "Error calling play", e);
                    }
                }
            }

            @Override
            public void onPause() {
                Log.d(TAG, "onPause");
                if (bound && musicService != null) {
                    try {
                        musicService.pause();
                        updatePlaybackState(PlaybackStateCompat.STATE_PAUSED);
                    } catch (Exception e) {
                        Log.e(TAG, "Error calling pause", e);
                    }
                }
            }

            @Override
            public void onSkipToNext() {
                Log.d(TAG, "onSkipToNext");
                if (bound && musicService != null) {
                    try {
                        musicService.skipToNext();
                    } catch (Exception e) {
                        Log.e(TAG, "Error calling skipToNext", e);
                    }
                }
            }

            @Override
            public void onSkipToPrevious() {
                Log.d(TAG, "onSkipToPrevious");
                if (bound && musicService != null) {
                    try {
                        musicService.skipToPrevious();
                    } catch (Exception e) {
                        Log.e(TAG, "Error calling skipToPrevious", e);
                    }
                }
            }

            @Override
            public void onStop() {
                Log.d(TAG, "onStop");
                if (bound && musicService != null) {
                    try {
                        musicService.stop();
                        updatePlaybackState(PlaybackStateCompat.STATE_STOPPED);
                    } catch (Exception e) {
                        Log.e(TAG, "Error calling stop", e);
                    }
                }
            }

            @Override
            public void onSeekTo(long pos) {
                Log.d(TAG, "onSeekTo: " + pos);
                if (bound && musicService != null) {
                    try {
                        musicService.seekTo((float)(pos / 1000.0));
                    } catch (Exception e) {
                        Log.e(TAG, "Error calling seekTo", e);
                    }
                }
            }
        });

        mediaSession.setActive(true);
        setSessionToken(mediaSession.getSessionToken());
        Log.d(TAG, "Media session created and token set");
        
        // Start polling for metadata updates
        startMetadataPolling();
    }

    private void bindToMusicService() {
        Log.d(TAG, "Attempting to bind to MusicService");
        Intent intent = new Intent(this, com.doublesymmetry.trackplayer.service.MusicService.class);
        try {
            bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        } catch (Exception e) {
            Log.e(TAG, "Error binding to MusicService", e);
            scheduleRetry();
        }
    }

    private void setupMediaSession() {
        // Update metadata from the current track if available
        updateMetadataFromMusicService();
    }

    private void startMetadataPolling() {
        retryHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                updateMetadataFromMusicService();
                retryHandler.postDelayed(this, 2000); // Poll every 2 seconds
            }
        }, 1000);
    }

    private void updateMetadataFromMusicService() {
        if (!bound || musicService == null) {
            return;
        }

        try {
            com.doublesymmetry.trackplayer.model.Track currentTrack = musicService.getCurrentTrack();
            if (currentTrack != null) {
                android.support.v4.media.MediaMetadataCompat.Builder metadataBuilder = 
                    new android.support.v4.media.MediaMetadataCompat.Builder();
                
                String title = currentTrack.getTitle();
                String artist = currentTrack.getArtist();
                String album = currentTrack.getAlbum();
                android.net.Uri artworkUri = currentTrack.getArtwork();
                Long durationMs = currentTrack.getDuration();

                if (title != null) metadataBuilder.putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_TITLE, title);
                if (artist != null) metadataBuilder.putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ARTIST, artist);
                if (album != null) metadataBuilder.putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM, album);
                if (durationMs != null && durationMs > 0) metadataBuilder.putLong(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
                
                // Try to load artwork
                if (artworkUri != null) {
                    String artworkUrl = artworkUri.toString();
                    metadataBuilder.putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, artworkUrl);
                    metadataBuilder.putString(android.support.v4.media.MediaMetadataCompat.METADATA_KEY_ART_URI, artworkUrl);
                }

                mediaSession.setMetadata(metadataBuilder.build());
                
                // Update playback state - check if playWhenReady to determine if playing
                int playbackState = PlaybackStateCompat.STATE_PAUSED;
                try {
                    boolean isPlaying = musicService.getPlayWhenReady();
                    playbackState = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
                } catch (Exception e) {
                    Log.w(TAG, "Error getting playback state", e);
                }
                updatePlaybackState(playbackState);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error updating metadata", e);
        }
    }

    private void updatePlaybackState(int state) {
        long position = 0;
        if (bound && musicService != null) {
            try {
                position = (long)(musicService.getPositionInSeconds() * 1000);
            } catch (Exception ignored) {}
        }

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                .setActions(
                        PlaybackStateCompat.ACTION_PLAY |
                        PlaybackStateCompat.ACTION_PAUSE |
                        PlaybackStateCompat.ACTION_PLAY_PAUSE |
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                        PlaybackStateCompat.ACTION_STOP |
                        PlaybackStateCompat.ACTION_SEEK_TO)
                .setState(state, position, 1.0f);
        
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
        return new BrowserRoot(MEDIA_ROOT_ID, null);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        Log.d(TAG, "onLoadChildren called for parentId: " + parentId);
        
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        
        if (MEDIA_ROOT_ID.equals(parentId)) {
            MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
                    .setMediaId("now_playing")
                    .setTitle("Now Playing")
                    .setSubtitle("Control playback from your phone")
                    .build();
            items.add(new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
        }
        
        result.sendResult(items);
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "AutoMediaBrowserService onDestroy");
        if (retryHandler != null) {
            retryHandler.removeCallbacksAndMessages(null);
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
