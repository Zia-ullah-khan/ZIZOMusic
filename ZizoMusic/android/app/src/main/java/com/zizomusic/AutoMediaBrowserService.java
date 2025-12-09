package com.zizomusic;

import android.content.ComponentName;
import android.content.Context;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media.MediaBrowserServiceCompat;
import java.util.ArrayList;
import java.util.List;

public class AutoMediaBrowserService extends MediaBrowserServiceCompat {
    private static final String TAG = "AutoMediaBrowserService";
    private static final String MEDIA_ROOT_ID = "zizo_root";
    private static final int MAX_RETRY_ATTEMPTS = 30;
    private static final long RETRY_DELAY_MS = 1000;

    private Handler retryHandler;
    private int retryCount = 0;
    private boolean sessionTokenSet = false;
    private MediaSessionManager mediaSessionManager;
    private MediaSessionCompat placeholderSession;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "AutoMediaBrowserService onCreate");
        retryHandler = new Handler(Looper.getMainLooper());
        mediaSessionManager = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
        
        // Create placeholder session immediately so Android Auto has something to connect to
        createPlaceholderSession();
        
        // Then try to find the real session
        findAndSetSessionToken();
    }

    private void createPlaceholderSession() {
        if (placeholderSession != null) return;
        
        Log.d(TAG, "Creating placeholder media session");
        try {
            placeholderSession = new MediaSessionCompat(this, TAG);
            placeholderSession.setActive(true);
            setSessionToken(placeholderSession.getSessionToken());
            Log.d(TAG, "Placeholder session created and token set");
        } catch (Exception e) {
            Log.e(TAG, "Error creating placeholder session", e);
        }
    }

    private void findAndSetSessionToken() {
        Log.d(TAG, "Looking for TrackPlayer media session, attempt: " + (retryCount + 1));

        try {
            List<MediaController> controllers = mediaSessionManager.getActiveSessions(null);
            
            Log.d(TAG, "Found " + controllers.size() + " active media sessions");

            for (MediaController controller : controllers) {
                String packageName = controller.getPackageName();
                Log.d(TAG, "Found session from package: " + packageName);
                
                if (packageName.equals(getPackageName())) {
                    // Found our app's session (TrackPlayer)
                    android.media.session.MediaSession.Token token = controller.getSessionToken();
                    MediaSessionCompat.Token compatToken = MediaSessionCompat.Token.fromToken(token);
                    setSessionToken(compatToken);
                    sessionTokenSet = true;
                    retryCount = 0;
                    Log.d(TAG, "TrackPlayer session token set successfully!");
                    
                    // Clean up placeholder
                    if (placeholderSession != null) {
                        placeholderSession.setActive(false);
                        placeholderSession.release();
                        placeholderSession = null;
                    }
                    return;
                }
            }
        } catch (SecurityException e) {
            Log.w(TAG, "SecurityException - need notification listener permission", e);
        } catch (Exception e) {
            Log.e(TAG, "Error finding media session", e);
        }

        // If not found, schedule retry
        scheduleRetry();
    }

    private void scheduleRetry() {
        if (retryCount < MAX_RETRY_ATTEMPTS) {
            retryCount++;
            retryHandler.postDelayed(this::findAndSetSessionToken, RETRY_DELAY_MS);
        } else {
            Log.w(TAG, "Max retry attempts reached. Using placeholder session.");
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
        if (placeholderSession != null) {
            placeholderSession.setActive(false);
            placeholderSession.release();
        }
        super.onDestroy();
    }
}
