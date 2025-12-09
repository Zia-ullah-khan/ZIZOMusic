import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
// import { CarPlay, ListTemplate } from 'react-native-carplay';
import TrackPlayer, {
  Capability,
  Event,
  RepeatMode,
  State,
  usePlaybackState,
  useTrackPlayerEvents,
  AppKilledPlaybackBehavior
} from 'react-native-track-player';

interface Recommendation {
  title: string;
  artist: string;
  thumbnail: string;
  query: string;
}

interface SongInfo {
  title: string;
  artist: string;
  thumbnail: string;
}

const API_URL = "https://api.zizomusic.com";

const setupPlayer = async () => {
  try {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
        Capability.JumpForward,
        Capability.JumpBackward,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      progressUpdateEventInterval: 2,
      forwardJumpInterval: 10,
      backwardJumpInterval: 10,
    });
  } catch (e) {
    console.log("Player already setup", e);
  }
};

export default function App() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [recentSongs, setRecentSongs] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(null);
  const [userID, setUserID] = useState<string>("");
  const [isLooping, setIsLooping] = useState(false);
  const [isAutoplay, setIsAutoplay] = useState(true);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  
  const playbackState = usePlaybackState();

  useEffect(() => {
    const init = async () => {
      await setupPlayer();
      setIsPlayerReady(true);

      // Disabled CarPlay templates - using native Android Auto media browser instead
      // const template = new ListTemplate({
      //   sections: [{
      //     header: "ZizoMusic",
      //     items: [{ text: "Recent Songs" }, { text: "Recommendations" }]
      //   }],
      //   title: "ZizoMusic",
      // });

      // const onConnect = () => {
      //   console.log("CarPlay/Android Auto connected");
      //   CarPlay.setRootTemplate(template);
      // };

      // CarPlay.registerOnConnect(onConnect);

      // if (CarPlay.connected) {
      //   onConnect();
      // }
      
      try {
        const storedUserID = await AsyncStorage.getItem('userID');
        const storedRecentSongs = await AsyncStorage.getItem('recentSongs');
        
        if (storedUserID) {
          setUserID(storedUserID);
        }
        
        if (storedRecentSongs) {
          setRecentSongs(JSON.parse(storedRecentSongs));
        }

        fetchRecommendations(storedUserID || "");
      } catch (e) {
        console.error("Failed to load storage", e);
        fetchRecommendations("");
      }
    };
    init();
  }, []);

  useTrackPlayerEvents([Event.PlaybackQueueEnded, Event.RemoteNext, Event.RemotePrevious], async (event) => {
    if (event.type === Event.PlaybackQueueEnded && isAutoplay && recommendations.length > 0) {
      playSong(recommendations[0], true);
    }
    if (event.type === Event.RemoteNext && recommendations.length > 0) {
      playSong(recommendations[0], true);
    }
    if (event.type === Event.RemotePrevious && recentSongs.length > 0) {
      playSong(recentSongs[0], false);
    }
  });

  const fetchRecommendations = async (currentUserID: string) => {
    try {
      let url = `${API_URL}/recommend`;
      if (currentUserID) {
        url += `?user_id=${currentUserID}`;
      }
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRecommendations(data.recommendations);
        
        if (data.user_id && data.user_id !== currentUserID) {
            setUserID(data.user_id);
            AsyncStorage.setItem('userID', data.user_id).catch(err => console.error("Failed to save userID", err));
        }
      }
    } catch (e) {
      console.error("Failed to fetch recommendations", e);
    }
  };

  const addToHistory = (songName: string) => {
    setRecentSongs(prev => {
      const newHistory = [songName, ...prev.filter(s => s !== songName)].slice(0, 10);
      AsyncStorage.setItem('recentSongs', JSON.stringify(newHistory)).catch(err => console.error("Failed to save history", err));
      return newHistory;
    });
    fetchRecommendations(userID);
  };

  const playSong = async (songInput: string | Recommendation, isAutoplayTriggered = false) => {
    if (!isPlayerReady) return;

    let songName = "";
    let songInfo: SongInfo | null = null;

    if (typeof songInput === 'string') {
        songName = songInput;
        try {
            const res = await fetch(`${API_URL}/info/${encodeURIComponent(songName)}`);
            if (res.ok) {
                songInfo = await res.json();
            }
        } catch (e) {
            console.error(e);
        }
    } else {
        songName = songInput.query;
        songInfo = {
            title: songInput.title,
            artist: songInput.artist,
            thumbnail: songInput.thumbnail
        };
    }

    if (!songName) return;

    setQuery(songName);
    if (songInfo) setCurrentSong(songInfo);
    setStatus("Searching & Loading...");
    
    setRecommendations(prev => prev.filter(r => r.query !== songName));

    if (!isAutoplayTriggered) {
        addToHistory(songName);
    } else {
        // Simplified: Add to history immediately for now, or use setTimeout logic if needed
        addToHistory(songName); 
    }

    let songUrl = `${API_URL}/stream/${encodeURIComponent(songName)}`;
    if (userID) {
        songUrl += `?user_id=${userID}`;
    }

    try {
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: songName,
        url: songUrl,
        title: songInfo?.title || songName,
        artist: songInfo?.artist || "ZIZO Music",
        artwork: songInfo?.thumbnail || undefined,
        duration: 0,
      });
      await TrackPlayer.play();
      setStatus("Playing");
      console.log('Track added:', { title: songInfo?.title, artist: songInfo?.artist, artwork: songInfo?.thumbnail });
    } catch (e) {
      console.error('Error playing song:', e);
      setStatus("Error playing");
    }
  };

  const toggleLoop = async () => {
    const newLooping = !isLooping;
    setIsLooping(newLooping);
    // TrackPlayer RepeatMode: Off = 0, Track = 1, Queue = 2
    await TrackPlayer.setRepeatMode(newLooping ? RepeatMode.Track : RepeatMode.Off);
  };

  const togglePlayback = async () => {
    const state = await TrackPlayer.getState();
    if (state === State.Playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>ZIZO Music</Text>
          
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Enter song name..."
              placeholderTextColor="#9ca3af"
              onSubmitEditing={() => playSong(query)}
            />
          <TouchableOpacity 
            onPress={() => playSong(query)}
            style={styles.playButton}
          >
            <Text style={styles.playButtonText}>Play</Text>
          </TouchableOpacity>
        </View>

        {status ? <Text style={styles.statusText}>{status}</Text> : null}

        {currentSong && (
          <View style={styles.playerContainer}>
            {currentSong.thumbnail ? (
              <Image 
                source={{ uri: currentSong.thumbnail }} 
                style={styles.artwork}
              />
            ) : (
              <View style={[styles.artwork, styles.placeholderArtwork]} />
            )}
            <Text style={styles.songTitle}>{currentSong.title}</Text>
            <Text style={styles.artistName}>{currentSong.artist}</Text>
            
            <View style={styles.controls}>
               <TouchableOpacity onPress={togglePlayback} style={styles.controlButton}>
                  <Text style={styles.controlButtonText}>
                    {(playbackState.state === State.Playing) ? "Pause" : "Play"}
                  </Text>
               </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.optionsContainer}>
          <TouchableOpacity
              onPress={toggleLoop}
              style={[styles.optionButton, isLooping ? styles.optionButtonActive : styles.optionButtonInactive]}
          >
              <Text style={isLooping ? styles.optionTextActive : styles.optionTextInactive}>
                  Loop: {isLooping ? "ON" : "OFF"}
              </Text>
          </TouchableOpacity>
          <TouchableOpacity
              onPress={() => setIsAutoplay(!isAutoplay)}
              style={[styles.optionButton, isAutoplay ? styles.optionButtonActive : styles.optionButtonInactive]}
          >
              <Text style={isAutoplay ? styles.optionTextActive : styles.optionTextInactive}>
                  Autoplay: {isAutoplay ? "ON" : "OFF"}
              </Text>
          </TouchableOpacity>
        </View>
        
        {recentSongs.length > 0 && (
          <View style={styles.listContainer}>
            <Text style={styles.sectionTitle}>Recently Played</Text>
            {recentSongs.map((song, index) => (
              <TouchableOpacity 
                key={index}
                onPress={() => playSong(song)}
                style={styles.listItem}
              >
                <Text style={styles.listItemText}>{song}</Text>
                <Text style={styles.playActionText}>Play</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {recommendations.length > 0 && (
          <View style={styles.listContainer}>
            <Text style={styles.sectionTitle}>Recommended for You</Text>
            {recommendations.map((rec, index) => (
              <TouchableOpacity 
                key={index}
                onPress={() => playSong(rec.query)}
                style={styles.listItem}
              >
                {rec.thumbnail && (
                  <Image source={{ uri: rec.thumbnail }} style={styles.listThumbnail} />
                )}
                <View style={styles.listInfo}>
                  <Text style={styles.listItemTitle}>{rec.title}</Text>
                  <Text style={styles.listItemArtist}>{rec.artist}</Text>
                </View>
                <Text style={styles.playActionText}>Play</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Streaming via HTTP from FastAPI backend.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 32,
  },
  searchContainer: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 400,
    marginBottom: 32,
    gap: 16,
  },
  input: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#27272a', // zinc-800
    color: '#ffffff',
    fontSize: 16,
  },
  playButton: {
    backgroundColor: '#dc2626', // red-600
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    justifyContent: 'center',
  },
  playButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  statusText: {
    color: '#9ca3af',
    marginBottom: 16,
  },
  playerContainer: {
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  artwork: {
    width: 256,
    height: 256,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: '#333',
  },
  placeholderArtwork: {
    backgroundColor: '#27272a',
  },
  songTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  artistName: {
    fontSize: 18,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 16,
  },
  controls: {
    flexDirection: 'row',
    gap: 16,
  },
  controlButton: {
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 30,
    borderRadius: 20,
  },
  controlButtonText: {
    color: '#000000',
    fontWeight: 'bold',
  },
  optionsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
    width: '100%',
    maxWidth: 400,
    justifyContent: 'center',
  },
  optionButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
  },
  optionButtonActive: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  optionButtonInactive: {
    backgroundColor: '#27272a',
    borderColor: '#27272a',
  },
  optionTextActive: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  optionTextInactive: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  listContainer: {
    marginTop: 32,
    width: '100%',
    maxWidth: 400,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b', // zinc-900
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  listThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 4,
    marginRight: 12,
  },
  listInfo: {
    flex: 1,
  },
  listItemText: {
    color: '#ffffff',
    fontSize: 16,
  },
  listItemTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  listItemArtist: {
    color: '#9ca3af',
    fontSize: 12,
  },
  playActionText: {
    color: '#6b7280',
    fontSize: 12,
  },
  footer: {
    marginTop: 32,
    alignItems: 'center',
  },
  footerText: {
    color: '#6b7280',
    fontSize: 14,
  },
});
