import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StatusBar,
  GestureResponderEvent,
  Modal,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TrackPlayer, {
  Capability,
  Event,
  RepeatMode,
  State,
  Track,
  TrackType,
  usePlaybackState,
  useProgress,
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
  duration?: number;
}

interface Suggestion {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: string;
  score: number;
}

interface Album {
  id: string;
  title: string;
  year: string;
  thumbnail: string;
  songs: Recommendation[];
}

const ALBUM_PRESETS = [
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300", // Preset 1: Purple abstract
  "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300", // Preset 2: Blue abstract
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300", // Preset 3: Grid sunset
  "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=300", // Preset 4: Green matrix
];

const PRODUCTION_API_URL = "https://api.zizomusic.com";
const DEV_API_URL = Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://127.0.0.1:8000";
const API_URL = __DEV__ ? DEV_API_URL : PRODUCTION_API_URL;
const UPCOMING_QUEUE_SIZE = 12;
const SUGGESTION_DEBOUNCE_MS = 220;
const SUGGESTION_MIN_CHARS = 2;

const COLORS = {
  lavender: '#DEC5E3',
  iceBlue: '#CDEDFD',
  skyBlue: '#B6DCFE',
  cyan: '#A9F8FB',
  teal: '#81F7E5',
  background: '#070708',
  surface: '#121214',
  surfaceLight: '#1e1e24',
  textMuted: '#9ca3af',
  textLight: '#ffffff',
  textDark: '#000000',
  cardGradients: {
    synthwave: ['#DEC5E3', '#B6DCFE'],
    lofi: ['#81F7E5', '#CDEDFD'],
    techno: ['#A9F8FB', '#B6DCFE'],
    indie: ['#FF9F1C', '#DEC5E3'],
    hiphop: ['#EC4899', '#DEC5E3'],
    ambient: ['#3B82F6', '#CDEDFD'],
  }
};

const suggestionPlayKey = (s: Suggestion) => `${s.title} ${s.artist}`.trim();

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const renderHighlighted = (text: string, search: string, baseStyle: any, boldStyle: any) => {
  const tokens = search.trim().split(/\s+/).filter(t => t.length > 1).map(escapeRegex);
  if (tokens.length === 0) {
    return <Text numberOfLines={1} style={baseStyle}>{text}</Text>;
  }
  const splitter = new RegExp(`(${tokens.join('|')})`, 'ig');
  const tester = new RegExp(`^(${tokens.join('|')})$`, 'i');
  return (
    <Text numberOfLines={1} style={baseStyle}>
      {text.split(splitter).map((part, index) =>
        tester.test(part)
          ? <Text key={index} style={boldStyle}>{part}</Text>
          : part
      )}
    </Text>
  );
};

const formatTime = (seconds: number) => {
  if (!seconds || seconds < 0 || !isFinite(seconds)) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const streamFallbackUrl = (songName: string, userID: string) => {
  let url = `${API_URL}/stream/${encodeURIComponent(songName)}`;
  if (userID) {
    url += `?user_id=${userID}`;
  }
  return url;
};

interface ResolvedStream {
  url: string;
  type?: TrackType;
}

const resolveStream = async (songName: string, userID: string): Promise<ResolvedStream> => {
  const userParam = userID ? `?user_id=${userID}` : "";
  const fallback: ResolvedStream = { url: streamFallbackUrl(songName, userID) };

  try {
    const res = await fetch(`${API_URL}/play/${encodeURIComponent(songName)}${userParam}`);
    if (!res.ok) {
      return fallback;
    }
    const data = await res.json();
    return {
      url: `${API_URL}${data.url}`,
      type: data.type === "hls" ? TrackType.HLS : undefined,
    };
  } catch (e) {
    console.log("Stream resolve failed, using direct stream", e);
    return fallback;
  }
};

const toPlayerTrack = (songName: string, info: SongInfo | null, stream: ResolvedStream): Track => ({
  id: songName,
  url: stream.url,
  type: stream.type,
  title: info?.title || songName,
  artist: info?.artist || "ZIZO Music",
  artwork: info?.thumbnail || undefined,
  duration: info?.duration && info.duration > 0 ? info.duration : undefined,
});

const setupPlayer = async () => {
  try {
    await TrackPlayer.setupPlayer({
      minBuffer: 60,
      maxBuffer: 300,
      playBuffer: 1.5,
      backBuffer: 30,
      maxCacheSize: 256 * 1024,
    });
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
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      progressUpdateEventInterval: 1,
      forwardJumpInterval: 10,
      backwardJumpInterval: 10,
    });
  } catch (e) {
    console.log("Player already setup", e);
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'library'>('home');
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [isShuffled, setIsShuffled] = useState(false);
  const [likedTracks, setLikedTracks] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [recentSongs, setRecentSongs] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(null);
  const [userID, setUserID] = useState<string>("");
  const [isLooping, setIsLooping] = useState(false);
  const [isAutoplay, setIsAutoplay] = useState(true);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const [albums, setAlbums] = useState<Album[]>([]);
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [newAlbumYear, setNewAlbumYear] = useState("");
  const [newAlbumCover, setNewAlbumCover] = useState("https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300");
  const [modalError, setModalError] = useState("");

  const [activeAlbum, setActiveAlbum] = useState<Album | null>(null);
  const [showAddSongModal, setShowAddSongModal] = useState(false);
  const [songQuery, setSongQuery] = useState("");
  const [songSuggestions, setSongSuggestions] = useState<Suggestion[]>([]);

  const playbackState = usePlaybackState();
  const progress = useProgress(250);

  const recommendationsRef = useRef(recommendations);
  const userIDRef = useRef(userID);
  const isAutoplayRef = useRef(isAutoplay);
  const isPlayerReadyRef = useRef(isPlayerReady);
  const sliderWidthRef = useRef(1);
  const volumeSliderWidthRef = useRef(1);
  const lastHistoryIdRef = useRef("");
  const lastDurationSyncRef = useRef("");
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionRequestIdRef = useRef(0);
  const prefetchedIdsRef = useRef<Set<string>>(new Set());

  recommendationsRef.current = recommendations;
  userIDRef.current = userID;
  isAutoplayRef.current = isAutoplay;
  isPlayerReadyRef.current = isPlayerReady;

  useEffect(() => {
    const init = async () => {
      await setupPlayer();
      setIsPlayerReady(true);

      try {
        const storedUserID = await AsyncStorage.getItem('userID');
        const storedRecentSongs = await AsyncStorage.getItem('recentSongs');
        const storedLiked = await AsyncStorage.getItem('likedTracks');

        if (storedUserID) {
          setUserID(storedUserID);
        }

        if (storedRecentSongs) {
          setRecentSongs(JSON.parse(storedRecentSongs));
        }

        if (storedLiked) {
          setLikedTracks(new Set(JSON.parse(storedLiked)));
        }

        const storedAlbums = await AsyncStorage.getItem('createdAlbums');
        if (storedAlbums) {
          const parsed = JSON.parse(storedAlbums);
          if (Array.isArray(parsed)) {
            const migrated = parsed.map((a: any, idx: number) => ({
              id: a.id || `migrated-${idx}-${Date.now()}`,
              title: a.title || "",
              year: a.year || "",
              thumbnail: a.thumbnail || "",
              songs: Array.isArray(a.songs) ? a.songs : [],
            }));
            setAlbums(migrated);
          }
        }

        fetchRecommendations(storedUserID || "");
      } catch (e) {
        console.error("Failed to load storage", e);
        fetchRecommendations("");
      }
    };
    init();
  }, []);

  const fetchRecommendations = async (currentUserID: string) => {
    try {
      let url = `${API_URL}/recommend`;
      if (currentUserID) {
        url += `?user_id=${currentUserID}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRecommendations(data.recommendations || []);

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
    if (!songName || lastHistoryIdRef.current === songName) {
      return;
    }
    lastHistoryIdRef.current = songName;
    setRecentSongs(prev => {
      const newHistory = [songName, ...prev.filter(s => s !== songName)].slice(0, 10);
      AsyncStorage.setItem('recentSongs', JSON.stringify(newHistory)).catch(err => console.error("Failed to save history", err));
      return newHistory;
    });
    fetchRecommendations(userIDRef.current);
  };

  const removeRecentSong = (songName: string) => {
    setRecentSongs(prev => {
      const newHistory = prev.filter(s => s !== songName);
      AsyncStorage.setItem('recentSongs', JSON.stringify(newHistory)).catch(err => console.error("Failed to save history", err));
      return newHistory;
    });
  };

  const getGhostText = () => {
    if (suggestions.length === 0 || !query.trim()) return "";
    const topTitle = suggestions[0].title;
    if (topTitle.toLowerCase().startsWith(query.toLowerCase())) {
      return query + topTitle.slice(query.length);
    }
    return "";
  };

  const ghostText = getGhostText();

  const handleCreateAlbum = async () => {
    if (!newAlbumTitle.trim()) {
      setModalError("Please enter an album title.");
      return;
    }
    const newAlbum: Album = {
      id: Date.now().toString(),
      title: newAlbumTitle.trim(),
      year: newAlbumYear.trim() || new Date().getFullYear().toString(),
      thumbnail: newAlbumCover.trim(),
      songs: [],
    };
    const updatedAlbums = [newAlbum, ...albums];
    setAlbums(updatedAlbums);
    try {
      await AsyncStorage.setItem('createdAlbums', JSON.stringify(updatedAlbums));
    } catch (err) {
      console.error("Failed to save album to AsyncStorage", err);
    }
    
    // Reset inputs & close modal
    setNewAlbumTitle("");
    setNewAlbumYear("");
    setNewAlbumCover(ALBUM_PRESETS[0]);
    setModalError("");
    setShowCreateAlbumModal(false);
  };

  const fetchSongSuggestions = async (text: string) => {
    try {
      const res = await fetch(`${API_URL}/search/suggestions?q=${encodeURIComponent(text)}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        setSongSuggestions(data.suggestions || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSongQueryChange = (text: string) => {
    setSongQuery(text);
    if (text.trim().length >= SUGGESTION_MIN_CHARS) {
      if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = setTimeout(() => {
        fetchSongSuggestions(text);
      }, SUGGESTION_DEBOUNCE_MS);
    } else {
      setSongSuggestions([]);
    }
  };

  const handleAddSongToAlbum = async (song: Recommendation | Suggestion) => {
    if (!activeAlbum) return;

    const songToAdd: Recommendation = 'query' in song ? song : {
      title: song.title,
      artist: song.artist,
      thumbnail: song.thumbnail,
      query: `${song.title} ${song.artist}`.trim(),
    };

    if (activeAlbum.songs.some(s => s.title === songToAdd.title && s.artist === songToAdd.artist)) {
      setModalError("Song is already in this album!");
      return;
    }

    const updatedSongs = [...activeAlbum.songs, songToAdd];
    const updatedActiveAlbum = { ...activeAlbum, songs: updatedSongs };
    setActiveAlbum(updatedActiveAlbum);

    const updatedAlbums = albums.map(a => a.id === activeAlbum.id ? updatedActiveAlbum : a);
    setAlbums(updatedAlbums);
    try {
      await AsyncStorage.setItem('createdAlbums', JSON.stringify(updatedAlbums));
    } catch (err) {
      console.error("Failed to save updated albums", err);
    }

    setSongQuery("");
    setSongSuggestions([]);
    setModalError("");
    setShowAddSongModal(false);
  };

  const handleRemoveSongFromAlbum = async (songTitle: string) => {
    if (!activeAlbum) return;

    const updatedSongs = activeAlbum.songs.filter(s => s.title !== songTitle);
    const updatedActiveAlbum = { ...activeAlbum, songs: updatedSongs };
    setActiveAlbum(updatedActiveAlbum);

    const updatedAlbums = albums.map(a => a.id === activeAlbum.id ? updatedActiveAlbum : a);
    setAlbums(updatedAlbums);
    try {
      await AsyncStorage.setItem('createdAlbums', JSON.stringify(updatedAlbums));
    } catch (err) {
      console.error("Failed to save updated albums", err);
    }
  };

  const enqueueUpcoming = async (excludeId: string) => {
    const queue = await TrackPlayer.getQueue();
    const queuedIds = new Set(queue.map(track => String(track.id)));
    const upcomingRecs = recommendationsRef.current
      .filter(rec => rec.query && rec.query !== excludeId && !queuedIds.has(rec.query))
      .slice(0, UPCOMING_QUEUE_SIZE);

    const upcoming = await Promise.all(
      upcomingRecs.map(async rec => {
        const stream = await resolveStream(rec.query, userIDRef.current);
        return toPlayerTrack(rec.query, rec, stream);
      })
    );

    if (upcoming.length > 0) {
      await TrackPlayer.add(upcoming);
    }
  };

  const topUpQueue = async () => {
    const queue = await TrackPlayer.getQueue();
    const index = await TrackPlayer.getActiveTrackIndex();
    if (index == null) {
      return;
    }
    const remaining = queue.length - index - 1;
    if (remaining >= 4) {
      return;
    }
    const active = queue[index];
    await enqueueUpcoming(String(active?.id || ""));
  };

  const syncTrackDuration = async () => {
    const progressNow = await TrackPlayer.getProgress();
    const index = await TrackPlayer.getActiveTrackIndex();
    const active = await TrackPlayer.getActiveTrack();
    if (index == null || !active || progressNow.duration <= 0) {
      return;
    }
    const key = `${active.id}:${Math.round(progressNow.duration)}`;
    if (lastDurationSyncRef.current === key) {
      return;
    }
    lastDurationSyncRef.current = key;
    await TrackPlayer.updateMetadataForTrack(index, { duration: progressNow.duration });
  };

  const clearSuggestions = () => {
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }
    suggestionRequestIdRef.current += 1;
    setSuggestions([]);
    setHighlightedIndex(0);
  };

  const prefetchSuggestion = (s: Suggestion) => {
    if (!s.id || prefetchedIdsRef.current.has(s.id)) {
      return;
    }
    prefetchedIdsRef.current.add(s.id);
    fetch(`${API_URL}/cache/prefetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: s.id, query: suggestionPlayKey(s) }),
    }).catch(() => {
      prefetchedIdsRef.current.delete(s.id);
    });
  };

  const fetchSuggestions = async (text: string) => {
    const requestId = ++suggestionRequestIdRef.current;
    try {
      const res = await fetch(`${API_URL}/search/suggestions?q=${encodeURIComponent(text)}&limit=5`);
      if (!res.ok || requestId !== suggestionRequestIdRef.current) {
        return;
      }
      const data = await res.json();
      if (requestId !== suggestionRequestIdRef.current) {
        return;
      }
      const items: Suggestion[] = data.suggestions || [];
      setSuggestions(items);
      setHighlightedIndex(0);
      if (items[0]) {
        prefetchSuggestion(items[0]);
      }
    } catch (e) {
      console.error("Failed to fetch suggestions", e);
    }
  };

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }

    const trimmed = text.trim();
    if (trimmed.length < SUGGESTION_MIN_CHARS) {
      suggestionRequestIdRef.current += 1;
      setSuggestions([]);
      setHighlightedIndex(0);
      return;
    }

    suggestionTimerRef.current = setTimeout(() => fetchSuggestions(trimmed), SUGGESTION_DEBOUNCE_MS);
  };

  const playSuggestion = (s: Suggestion) => {
    playSong({
      title: s.title,
      artist: s.artist,
      thumbnail: s.thumbnail,
      query: suggestionPlayKey(s),
    });
  };

  const onSearchSubmit = () => {
    if (suggestions.length > 0) {
      const target = suggestions[Math.min(highlightedIndex, suggestions.length - 1)];
      playSuggestion(target);
      return;
    }
    playSong(query);
  };

  const onSearchKeyPress = (key: string) => {
    if (suggestions.length === 0) {
      return;
    }
    if (key === 'ArrowDown') {
      setHighlightedIndex(prev => (prev + 1) % suggestions.length);
    } else if (key === 'ArrowUp') {
      setHighlightedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    }
  };

  const playSong = async (songInput: string | Recommendation) => {
    if (!isPlayerReadyRef.current) return;
    clearSuggestions();

    let songName = "";
    let songInfo: SongInfo | null = null;
    let infoPromise: Promise<SongInfo | null> | null = null;

    if (typeof songInput === 'string') {
        songName = songInput;
        infoPromise = fetch(`${API_URL}/info/${encodeURIComponent(songName)}`)
          .then(res => (res.ok ? res.json() : null))
          .catch(() => null);
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
    setCurrentSong(songInfo || { title: songName, artist: "", thumbnail: "" });
    setStatus("Searching & Loading...");
    setRecommendations(prev => prev.filter(r => r.query !== songName));
    addToHistory(songName);

    try {
      const stream = await resolveStream(songName, userIDRef.current);
      await TrackPlayer.reset();
      await TrackPlayer.add(toPlayerTrack(songName, songInfo, stream));
      await TrackPlayer.play();
      setStatus("Playing");
      enqueueUpcoming(songName).catch(err => console.error("Failed to enqueue upcoming", err));
    } catch (e) {
      console.error('Error playing song:', e);
      setStatus("Error playing");
    }

    if (infoPromise) {
      infoPromise.then(info => {
        if (!info) return;
        setCurrentSong(info);
        TrackPlayer.updateMetadataForTrack(0, {
          title: info.title,
          artist: info.artist,
          artwork: info.thumbnail || undefined,
          duration: info.duration && info.duration > 0 ? info.duration : undefined,
        }).catch(() => {});
      });
    }
  };

  useTrackPlayerEvents(
    [Event.PlaybackActiveTrackChanged, Event.PlaybackQueueEnded, Event.PlaybackProgressUpdated],
    async (event) => {
      if (event.type === Event.PlaybackActiveTrackChanged) {
        const track = event.track;
        if (!track) {
          return;
        }
        const songName = String(track.id || track.title || "");
        setCurrentSong({
          title: String(track.title || songName),
          artist: String(track.artist || "ZIZO Music"),
          thumbnail: typeof track.artwork === "string" ? track.artwork : "",
        });
        if (songName) {
          setQuery(songName);
          addToHistory(songName);
          setRecommendations(prev => prev.filter(r => r.query !== songName));
        }
        await topUpQueue();
        await syncTrackDuration();
      }

      if (event.type === Event.PlaybackProgressUpdated) {
        await syncTrackDuration();
      }

      if (event.type === Event.PlaybackQueueEnded && isAutoplayRef.current) {
        const nextRec = recommendationsRef.current[0];
        if (nextRec) {
          playSong(nextRec);
        }
      }
    }
  );

  const toggleLoop = async () => {
    const newLooping = !isLooping;
    setIsLooping(newLooping);
    await TrackPlayer.setRepeatMode(newLooping ? RepeatMode.Track : RepeatMode.Off);
  };

  const togglePlayback = async () => {
    const state = await TrackPlayer.getPlaybackState();
    if (state.state === State.Playing) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  };

  const toggleLike = async (title: string) => {
    const newLiked = new Set(likedTracks);
    if (newLiked.has(title)) {
      newLiked.delete(title);
    } else {
      newLiked.add(title);
    }
    setLikedTracks(newLiked);
    await AsyncStorage.setItem('likedTracks', JSON.stringify(Array.from(newLiked)));
  };

  const skipNext = async () => {
    try {
      const queue = await TrackPlayer.getQueue();
      const index = await TrackPlayer.getActiveTrackIndex();
      if (index != null && index < queue.length - 1) {
        await TrackPlayer.skipToNext();
        return;
      }
    } catch (e) {
      console.error(e);
    }
    const nextRec = recommendationsRef.current[0];
    if (nextRec) {
      await playSong(nextRec);
    }
  };

  const skipPrevious = async () => {
    try {
      const index = await TrackPlayer.getActiveTrackIndex();
      const progressNow = await TrackPlayer.getProgress();
      if (progressNow.position > 3) {
        await TrackPlayer.seekTo(0);
        return;
      }
      if (index != null && index > 0) {
        await TrackPlayer.skip(index - 1);
        return;
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Seeker custom slider handlers
  const positionForSlider = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.locationX;
    const ratio = Math.max(0, Math.min(1, x / sliderWidthRef.current));
    return ratio * (progress.duration || 0);
  };

  const onSliderGrant = (event: GestureResponderEvent) => {
    if (progress.duration <= 0) return;
    setIsSeeking(true);
    setSeekPreview(positionForSlider(event));
  };

  const onSliderMove = (event: GestureResponderEvent) => {
    if (!isSeeking || progress.duration <= 0) return;
    setSeekPreview(positionForSlider(event));
  };

  const onSliderRelease = async (event: GestureResponderEvent) => {
    if (progress.duration <= 0) {
      setIsSeeking(false);
      return;
    }
    const nextPosition = positionForSlider(event);
    setSeekPreview(nextPosition);
    try {
      await TrackPlayer.seekTo(nextPosition);
    } catch (e) {
      console.error("Seek failed", e);
    }
    setIsSeeking(false);
  };

  const displayedPosition = isSeeking ? seekPreview : progress.position;
  const sliderRatio = progress.duration > 0 ? Math.max(0, Math.min(1, displayedPosition / progress.duration)) : 0;

  // Volume slider handlers
  const volumeForSlider = (event: GestureResponderEvent) => {
    const x = event.nativeEvent.locationX;
    return Math.max(0, Math.min(1, x / volumeSliderWidthRef.current));
  };

  const onVolumeGrant = async (event: GestureResponderEvent) => {
    const vol = volumeForSlider(event);
    setVolume(vol);
    await TrackPlayer.setVolume(vol);
  };

  const onVolumeMove = async (event: GestureResponderEvent) => {
    const vol = volumeForSlider(event);
    setVolume(vol);
    await TrackPlayer.setVolume(vol);
  };

  const selectGenre = (genre: string) => {
    setQuery(genre);
    fetchSuggestions(genre);
  };

  // Live mapping of playlist tracks based on current state or recommendations
  const getLibraryTracks = () => {
    if (recommendations.length > 0) {
      return recommendations.slice(0, 10);
    }
    // Fallback if recommendations are empty
    return [
      { title: "Astral Drift", artist: "Hyperion", query: "Astral Drift Hyperion", thumbnail: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150" },
      { title: "Virtual Horizon", artist: "Kozmos", query: "Virtual Horizon Kozmos", thumbnail: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150" },
      { title: "Synthesized Mind", artist: "Vector Unit", query: "Synthesized Mind Vector Unit", thumbnail: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150" },
      { title: "Retro Future", artist: "Daft Punk", query: "Retro Future Daft Punk", thumbnail: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150" },
      { title: "Neon Wanderer", artist: "Stellar", query: "Neon Wanderer Stellar", thumbnail: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150" },
    ];
  };

  // Artist data (live mapping)
  const getArtistDetails = () => {
    const defaultArtist = "Aetheris";
    const defaultArt = "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=800";
    const currentArtist = currentSong && currentSong.artist !== "ZIZO Music" ? currentSong.artist : defaultArtist;
    const currentArt = currentSong?.thumbnail || defaultArt;
    
    // Map dynamic songs for the artist
    const popularTracks = recommendations.slice(0, 3).map((rec, idx) => ({
      id: `0${idx + 1}`,
      title: rec.title,
      artist: rec.artist,
      plays: `${(15.2 - idx * 3.4).toFixed(1)}M`,
      thumbnail: rec.thumbnail,
      query: rec.query,
    }));

    if (popularTracks.length === 0) {
      // Fallback popular tracks
      popularTracks.push(
        { id: "01", title: "Lost In Translation", artist: currentArtist, plays: "14.2M", thumbnail: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150", query: `Lost In Translation ${currentArtist}` },
        { id: "02", title: "Static Dreams", artist: currentArtist, plays: "8.9M", thumbnail: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150", query: `Static Dreams ${currentArtist}` },
        { id: "03", title: "Subzero", artist: currentArtist, plays: "5.1M", thumbnail: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150", query: `Subzero ${currentArtist}` }
      );
    }

    return {
      name: currentArtist.toUpperCase(),
      banner: currentArt,
      listeners: "1,452,098 monthly listeners",
      popularTracks,
      albums: albums
    };
  };

  const artist = getArtistDetails();
  const libraryTracks = getLibraryTracks();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        
        {/* Main Content Area based on Active Tab */}
        <View style={styles.tabContentContainer}>
          {activeAlbum ? (
            <ScrollView style={styles.scrollScreen} contentContainerStyle={{ paddingBottom: 120 }}>
              {/* Album Details Screen */}
              <View style={styles.playlistHeaderContainer}>
                <Image 
                  source={{ uri: activeAlbum.thumbnail || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400" }} 
                  style={styles.playlistCoverArtBig} 
                />
                <View style={styles.playlistDetailsMetadataContainer}>
                  <TouchableOpacity style={styles.playlistBackButton} onPress={() => setActiveAlbum(null)}>
                    <Text style={styles.backButtonText}>❮</Text>
                  </TouchableOpacity>
                  <Text numberOfLines={2} style={styles.playlistBigTitleHeader}>{activeAlbum.title}</Text>
                  <Text style={styles.playlistCuratorText}>
                    Album • Released in <Text style={styles.playlistCuratorHighlightText}>{activeAlbum.year}</Text>
                  </Text>
                  <Text style={styles.playlistTracksDurationCountText}>
                    {activeAlbum.songs.length} tracks • {formatTime(activeAlbum.songs.length * 205)}
                  </Text>
                </View>
              </View>

              <View style={styles.playlistControlsRowContainer}>
                <TouchableOpacity 
                  style={[styles.playlistPlayCircularButton, activeAlbum.songs.length === 0 && { opacity: 0.5 }]} 
                  onPress={() => activeAlbum.songs.length > 0 && playSong(activeAlbum.songs[0])}
                  disabled={activeAlbum.songs.length === 0}
                >
                  <Text style={styles.playlistPlayIconArrowSymbol}>▶</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.addSongBtn} 
                  onPress={() => {
                    setSongQuery("");
                    setSongSuggestions([]);
                    setModalError("");
                    setShowAddSongModal(true);
                  }}
                >
                  <Text style={styles.addSongBtnText}>+ Add Songs</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.playlistTracksListContainer}>
                {activeAlbum.songs.length === 0 ? (
                  <View style={styles.albumSongsPlaceholder}>
                    <Text style={styles.albumPlaceholderIcon}>🎵</Text>
                    <Text style={styles.albumPlaceholderText}>This album is empty.</Text>
                    <TouchableOpacity 
                      style={styles.albumPlaceholderBtn}
                      onPress={() => {
                        setSongQuery("");
                        setSongSuggestions([]);
                        setModalError("");
                        setShowAddSongModal(true);
                      }}
                    >
                      <Text style={styles.albumPlaceholderBtnText}>Add Some Tracks</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  activeAlbum.songs.map((track, index) => (
                    <View key={index} style={styles.albumTrackRow}>
                      <TouchableOpacity 
                        style={styles.albumTrackClickableArea}
                        onPress={() => playSong(track)}
                      >
                        <Text style={styles.playlistTrackIndexNumberText}>{String(index + 1).padStart(2, '0')}</Text>
                        <Image source={{ uri: track.thumbnail }} style={styles.playlistTrackThumbnailImage} />
                        <View style={styles.playlistTrackMetaDetails}>
                          <Text numberOfLines={1} style={styles.playlistTrackTitleLabelText}>{track.title}</Text>
                          <Text numberOfLines={1} style={styles.playlistTrackArtistLabelText}>{track.artist}</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={styles.removeTrackBtn}
                        onPress={() => handleRemoveSongFromAlbum(track.title)}
                      >
                        <Text style={styles.removeTrackBtnText}>🗑</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          ) : (
            <>
              {activeTab === 'home' && (
                <ScrollView style={styles.scrollScreen} contentContainerStyle={{ paddingBottom: 120 }}>
              {/* Artist Page - Screen 5 */}
              <View style={styles.artistHeaderContainer}>
                <Image source={{ uri: artist.banner }} style={styles.artistBannerImage} />
                <View style={styles.artistBannerOverlay}>
                  <TouchableOpacity style={styles.artistBackButton} onPress={() => setActiveTab('library')}>
                    <Text style={styles.backButtonText}>❮</Text>
                  </TouchableOpacity>
                  <View style={styles.artistMetaInfo}>
                    <Text style={styles.verifiedArtistText}>✓ VERIFIED ARTIST</Text>
                    <Text style={styles.artistNameText}>{artist.name}</Text>
                    <Text style={styles.listenersText}>{artist.listeners}</Text>
                  </View>
                  <TouchableOpacity style={styles.artistThreeDotsButton}>
                    <Text style={styles.threeDotsText}>•••</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.screenPadding}>
                {/* Popular Tracks Section */}
                <Text style={styles.sectionHeaderTitle}>Popular Tracks</Text>
                <View style={styles.popularTracksList}>
                  {artist.popularTracks.map((track) => (
                    <TouchableOpacity 
                      key={track.id} 
                      style={styles.popularTrackItem}
                      onPress={() => playSong({ title: track.title, artist: track.artist, thumbnail: track.thumbnail, query: track.query })}
                    >
                      <Text style={styles.trackNumberIndex}>{track.id}</Text>
                      <Image source={{ uri: track.thumbnail }} style={styles.trackThumbnailSmall} />
                      <View style={styles.popularTrackDetails}>
                        <Text numberOfLines={1} style={styles.trackTitleText}>{track.title}</Text>
                        <Text numberOfLines={1} style={styles.trackPlaysText}>{track.plays}</Text>
                      </View>
                      <View style={styles.playIconContainerOutline}>
                        <Text style={styles.playIconArrowSymbol}>▶</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Albums Section */}
                <View style={styles.albumsHeaderRow}>
                  <Text style={styles.sectionHeaderTitle}>Albums</Text>
                  <TouchableOpacity>
                                      <Text style={styles.seeAllTextLink}>See All</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.createAlbumHeaderBtn} 
                  onPress={() => {
                    setNewAlbumTitle("");
                    setNewAlbumYear("");
                    setNewAlbumCover(ALBUM_PRESETS[0]);
                    setModalError("");
                    setShowCreateAlbumModal(true);
                  }}
                >
                  <Text style={styles.createAlbumHeaderBtnText}>+ Create</Text>
                </TouchableOpacity>
              </View>
              {artist.albums.length === 0 ? (
                <View style={styles.albumPlaceholderContainer}>
                  <Text style={styles.albumPlaceholderIcon}>💿</Text>
                  <Text style={styles.albumPlaceholderText}>No albums created yet.</Text>
                  <TouchableOpacity 
                    style={styles.albumPlaceholderBtn}
                    onPress={() => {
                      setNewAlbumTitle("");
                      setNewAlbumYear("");
                      setNewAlbumCover(ALBUM_PRESETS[0]);
                      setModalError("");
                      setShowCreateAlbumModal(true);
                    }}
                  >
                    <Text style={styles.albumPlaceholderBtnText}>Create Album</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalAlbumsScroll}>
                                      {artist.albums.map((album, idx) => (
                      <TouchableOpacity key={idx} style={styles.albumCardItem} onPress={() => setActiveAlbum(album)}>
                        <Image source={{ uri: album.thumbnail }} style={styles.albumCoverImage} />
                        <Text numberOfLines={1} style={styles.albumTitleText}>{album.title}</Text>
                        <Text style={styles.albumYearText}>{album.year}</Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              )}
            </View>
          </ScrollView>
          )}

          {activeTab === 'search' && (
            <View style={styles.searchScreenRoot}>
              <View style={styles.searchHeaderWrapper}>
                <Text style={styles.searchPageLargeTitle}>Search</Text>
                
                {/* Search Bar - Screen 2 */}
                <View style={styles.searchBarWrapperContainer}>
                  <Text style={styles.searchGlassIcon}>🔍</Text>
                  
                  {/* Ghost text for predictive search autocomplete */}
                  {ghostText ? (
                    <Text style={styles.ghostText} pointerEvents="none" numberOfLines={1}>
                      <Text style={{ color: 'transparent' }}>{query}</Text>
                      <Text style={{ color: 'rgba(255, 255, 255, 0.35)' }}>{ghostText.slice(query.length)}</Text>
                    </Text>
                  ) : null}

                  <TextInput
                    style={[styles.searchBarTextInputField, { backgroundColor: 'transparent' }]}
                    value={query}
                    onChangeText={handleQueryChange}
                    placeholder="Artists, songs, or podcasts"
                    placeholderTextColor="#6b7280"
                    onSubmitEditing={onSearchSubmit}
                    onKeyPress={(e) => onSearchKeyPress(e.nativeEvent.key)}
                    blurOnSubmit={false}
                  />
                  {ghostText ? (
                    <TouchableOpacity 
                      style={styles.autocompleteBtn}
                      onPress={() => {
                        setQuery(ghostText);
                        handleQueryChange(ghostText);
                      }}
                    >
                      <Text style={styles.autocompleteBtnText}>⇥</Text>
                    </TouchableOpacity>
                  ) : null}
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => { setQuery(""); clearSuggestions(); }}>
                      <Text style={styles.searchClearIconText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <ScrollView style={styles.searchScrollableBody} contentContainerStyle={{ paddingBottom: 140 }}>
                {suggestions.length > 0 ? (
                  /* Suggestions list */
                  <View style={styles.searchSuggestionsListContainer}>
                    {suggestions.map((s, index) => (
                      <TouchableOpacity
                        key={s.id}
                        onPress={() => playSuggestion(s)}
                        style={[
                          styles.suggestionRowItem,
                          index === highlightedIndex && styles.suggestionItemHighlighted,
                        ]}
                      >
                        {s.thumbnail ? (
                          <Image source={{ uri: s.thumbnail }} style={styles.suggestionThumbnailImage} />
                        ) : (
                          <View style={[styles.suggestionThumbnailImage, styles.placeholderArtworkBackground]} />
                        )}
                        <View style={styles.suggestionTextContainer}>
                          {renderHighlighted(s.title, query, styles.suggestionTitleTextLabel, styles.suggestionBoldTextHighlight)}
                          {renderHighlighted(s.artist, query, styles.suggestionArtistTextLabel, styles.suggestionBoldTextHighlight)}
                        </View>
                        {s.duration ? (
                          <Text style={styles.suggestionDurationText}>{s.duration}</Text>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  /* Browse all genres grid - Screen 2 */
                  <View style={styles.screenPadding}>
                    {query.trim().length === 0 && recentSongs.length > 0 && (
                      <View style={styles.recentSearchesContainer}>
                        <View style={styles.recentSearchesHeaderRow}>
                          <Text style={styles.recentSearchesTitle}>Recent Searches</Text>
                          <TouchableOpacity onPress={() => { setRecentSongs([]); AsyncStorage.removeItem('recentSongs'); }}>
                            <Text style={styles.clearAllHistoryText}>Clear All</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.recentSearchesList}>
                          {recentSongs.map((song, idx) => (
                            <View key={idx} style={styles.recentSearchItemRow}>
                              <TouchableOpacity 
                                style={styles.recentSearchTextClickable}
                                onPress={() => {
                                  setQuery(song);
                                  handleQueryChange(song);
                                }}
                              >
                                <Text style={styles.recentSearchHistoryIcon}>🕒</Text>
                                <Text numberOfLines={1} style={styles.recentSearchText}>{song}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity 
                                style={styles.removeRecentItemBtn}
                                onPress={() => removeRecentSong(song)}
                              >
                                <Text style={styles.removeRecentItemSymbol}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    <Text style={styles.browseAllGenresTitle}>Browse all genres</Text>
                    <View style={styles.genresGridContainer}>
                      {[
                        { title: "Synthwave", color: COLORS.cardGradients.synthwave, thumb: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150" },
                        { title: "Lo-Fi Beats", color: COLORS.cardGradients.lofi, thumb: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150" },
                        { title: "Techno & Club", color: COLORS.cardGradients.techno, thumb: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150" },
                        { title: "Indie Rock", color: COLORS.cardGradients.indie, thumb: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150" },
                        { title: "Hip-Hop", color: COLORS.cardGradients.hiphop, thumb: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150" },
                        { title: "Chill Ambient", color: COLORS.cardGradients.ambient, thumb: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=150" },
                      ].map((genre, idx) => (
                        <TouchableOpacity 
                          key={idx} 
                          style={[styles.genreCardItemContainer, { backgroundColor: genre.color[0] }]}
                          onPress={() => selectGenre(genre.title)}
                        >
                          <Text style={styles.genreCardTitleLabel}>{genre.title}</Text>
                          <View style={styles.genreCoverArtRotatedPeekContainer}>
                            <Image source={{ uri: genre.thumb }} style={styles.genreCoverArtRotatedPeekImage} />
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </ScrollView>
            </View>
          )}

          {activeTab === 'library' && (
            <ScrollView style={styles.scrollScreen} contentContainerStyle={{ paddingBottom: 120 }}>
              {/* Library Screen - Screen 1 (Playlist details) */}
              <View style={styles.playlistHeaderContainer}>
                <Image 
                  source={{ uri: currentSong?.thumbnail || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400" }} 
                  style={styles.playlistCoverArtBig} 
                />
                <View style={styles.playlistDetailsMetadataContainer}>
                  <TouchableOpacity style={styles.playlistBackButton} onPress={() => setActiveTab('home')}>
                    <Text style={styles.backButtonText}>❮</Text>
                  </TouchableOpacity>
                  <Text numberOfLines={2} style={styles.playlistBigTitleHeader}>Cyberpunk Essentials</Text>
                  <Text style={styles.playlistCuratorText}>
                    Curated by <Text style={styles.playlistCuratorHighlightText}>Waveline</Text>
                  </Text>
                  <Text style={styles.playlistTracksDurationCountText}>
                    {libraryTracks.length} tracks • {formatTime(libraryTracks.length * 205)}
                  </Text>
                </View>
              </View>

              <View style={styles.playlistControlsRowContainer}>
                <TouchableOpacity style={styles.playlistPlayCircularButton} onPress={() => playSong(libraryTracks[0])}>
                  <Text style={styles.playlistPlayIconArrowSymbol}>▶</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.playlistTracksListContainer}>
                {libraryTracks.map((track, index) => (
                  <TouchableOpacity 
                    key={index} 
                    style={styles.playlistTrackRowItem}
                    onPress={() => playSong({ title: track.title, artist: track.artist, thumbnail: track.thumbnail, query: track.query })}
                  >
                    <Text style={styles.playlistTrackIndexNumberText}>{String(index + 1).padStart(2, '0')}</Text>
                    <Image source={{ uri: track.thumbnail }} style={styles.playlistTrackThumbnailImage} />
                    <View style={styles.playlistTrackMetaDetails}>
                      <Text numberOfLines={1} style={styles.playlistTrackTitleLabelText}>{track.title}</Text>
                      <Text numberOfLines={1} style={styles.playlistTrackArtistLabelText}>{track.artist}</Text>
                    </View>
                    <TouchableOpacity style={styles.playlistTrackMoreOptionsButton}>
                      <Text style={styles.playlistTrackMoreOptionsBurgerSymbol}>☰</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}
          </>
        )}
        </View>

        {/* Floating Mini Player Bar */}
        {currentSong && !showFullPlayer && (
          <TouchableOpacity style={styles.miniPlayerBarContainer} onPress={() => setShowFullPlayer(true)}>
            <Image source={{ uri: currentSong.thumbnail }} style={styles.miniPlayerArtworkImage} />
            <View style={styles.miniPlayerDetailsContainer}>
              <Text numberOfLines={1} style={styles.miniPlayerSongTitleText}>{currentSong.title}</Text>
              <Text numberOfLines={1} style={styles.miniPlayerSongArtistText}>{currentSong.artist}</Text>
            </View>
            <TouchableOpacity onPress={togglePlayback} style={styles.miniPlayerPlayPauseButton}>
              <Text style={styles.miniPlayerPlayPauseIconSymbol}>
                {(playbackState.state === State.Playing) ? "‖" : "▶"}
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* Custom Tab Bar - Screens 1, 2, 5 */}
        <View style={styles.bottomNavigationTabBarContainer}>
          <TouchableOpacity 
            style={styles.navigationTabItemButton} 
            onPress={() => { setActiveTab('home'); clearSuggestions(); setActiveAlbum(null); }}
          >
            <Text style={[styles.navigationTabItemIcon, activeTab === 'home' && styles.navigationTabItemIconActive]}>⌂</Text>
            <Text style={[styles.navigationTabItemLabel, activeTab === 'home' && styles.navigationTabItemLabelActive]}>Home</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.navigationTabItemButton} 
            onPress={() => { setActiveTab('search'); setActiveAlbum(null); }}
          >
            <Text style={[styles.navigationTabItemIcon, activeTab === 'search' && styles.navigationTabItemIconActive]}>🔍</Text>
            <Text style={[styles.navigationTabItemLabel, activeTab === 'search' && styles.navigationTabItemLabelActive]}>Search</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.navigationTabItemButton} 
            onPress={() => { setActiveTab('library'); clearSuggestions(); setActiveAlbum(null); }}
          >
            <Text style={[styles.navigationTabItemIcon, activeTab === 'library' && styles.navigationTabItemIconActive]}>⊗</Text>
            <Text style={[styles.navigationTabItemLabel, activeTab === 'library' && styles.navigationTabItemLabelActive]}>Library</Text>
          </TouchableOpacity>
        </View>

        {/* Full-Screen Now Playing Page (Screen 4) */}
        {currentSong && (
          <Modal
            visible={showFullPlayer}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowFullPlayer(false)}
          >
            <SafeAreaView style={styles.fullPlayerScreenRoot}>
              <StatusBar barStyle="light-content" backgroundColor="#070708" />
              
              {/* Header */}
              <View style={styles.fullPlayerHeaderRowContainer}>
                <TouchableOpacity style={styles.fullPlayerChevronDownButton} onPress={() => setShowFullPlayer(false)}>
                  <Text style={styles.fullPlayerChevronDownSymbol}>▼</Text>
                </TouchableOpacity>
                <Text style={styles.fullPlayerHeaderTitleText}>NOW PLAYING</Text>
                <TouchableOpacity style={styles.fullPlayerHeaderBurgerMenuButton}>
                  <Text style={styles.fullPlayerHeaderBurgerMenuSymbol}>☰</Text>
                </TouchableOpacity>
              </View>

              {/* Large Cover Art with Cyan Glow Shadow */}
              <View style={styles.fullPlayerArtworkGlowContainer}>
                <Image source={{ uri: currentSong.thumbnail }} style={styles.fullPlayerArtworkBigImage} />
              </View>

              {/* Song Information & Like Button */}
              <View style={styles.fullPlayerSongDetailsRowContainer}>
                <View style={styles.fullPlayerSongTextWrapper}>
                  <Text numberOfLines={1} style={styles.fullPlayerSongTitleText}>{currentSong.title}</Text>
                  <Text numberOfLines={1} style={styles.fullPlayerSongArtistText}>{currentSong.artist}</Text>
                </View>
                <TouchableOpacity onPress={() => toggleLike(currentSong.title)} style={styles.fullPlayerLikeHeartButton}>
                  <Text style={[styles.fullPlayerHeartIconSymbol, likedTracks.has(currentSong.title) && styles.fullPlayerHeartIconActive]}>
                    {likedTracks.has(currentSong.title) ? "♥" : "♡"}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Seek Slider Bar Progress */}
              <View style={styles.fullPlayerSeekSliderContainer}>
                <View
                  style={styles.fullPlayerSeekSliderHitbox}
                  onLayout={(event) => {
                    sliderWidthRef.current = event.nativeEvent.layout.width;
                  }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={onSliderGrant}
                  onResponderMove={onSliderMove}
                  onResponderRelease={onSliderRelease}
                >
                  <View style={styles.fullPlayerSeekSliderTrackBar}>
                    <View style={[styles.fullPlayerSeekSliderFillBar, { width: `${sliderRatio * 100}%` }]} />
                    <View style={[styles.fullPlayerSeekSliderThumbCircle, { left: `${sliderRatio * 100}%` }]} />
                  </View>
                </View>
                <View style={styles.fullPlayerTimeIndicatorsRow}>
                  <Text style={styles.fullPlayerTimeLabelText}>{formatTime(displayedPosition)}</Text>
                  <Text style={styles.fullPlayerTimeLabelText}>{formatTime(progress.duration)}</Text>
                </View>
              </View>

              {/* Playback Controls Row */}
              <View style={styles.fullPlayerPlaybackControlsRow}>
                <TouchableOpacity onPress={() => setIsShuffled(!isShuffled)} style={styles.fullPlayerSecondaryControlBtn}>
                  <Text style={[styles.fullPlayerControlBtnSymbol, isShuffled && styles.fullPlayerControlBtnActive]}>🔀</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={skipPrevious} style={styles.fullPlayerPrimaryControlBtn}>
                  <Text style={styles.fullPlayerControlBtnSymbol}>⏮</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={togglePlayback} style={styles.fullPlayerCircularPlayPauseGradientButton}>
                  <Text style={styles.fullPlayerCircularPlayPauseTextSymbol}>
                    {(playbackState.state === State.Playing) ? "‖" : "▶"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={skipNext} style={styles.fullPlayerPrimaryControlBtn}>
                  <Text style={styles.fullPlayerControlBtnSymbol}>⏭</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={toggleLoop} style={styles.fullPlayerSecondaryControlBtn}>
                  <Text style={[styles.fullPlayerControlBtnSymbol, isLooping && styles.fullPlayerControlBtnActive]}>🔁</Text>
                </TouchableOpacity>
              </View>

              {/* Volume Slider & Lyric/Queue Trigger Row */}
              <View style={styles.fullPlayerVolumeRowContainer}>
                <Text style={styles.fullPlayerVolumeSpeakerIconSymbol}>🔊</Text>
                <View
                  style={styles.fullPlayerVolumeSliderHitbox}
                  onLayout={(event) => {
                    volumeSliderWidthRef.current = event.nativeEvent.layout.width;
                  }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={onVolumeGrant}
                  onResponderMove={onVolumeMove}
                >
                  <View style={styles.fullPlayerVolumeSliderTrackBar}>
                    <View style={[styles.fullPlayerVolumeSliderFillBar, { width: `${volume * 100}%` }]} />
                    <View style={[styles.fullPlayerVolumeSliderThumbCircle, { left: `${volume * 100}%` }]} />
                  </View>
                </View>
                <TouchableOpacity style={styles.fullPlayerLyricsListTriggerButton}>
                  <Text style={styles.fullPlayerLyricsListSymbol}>☰</Text>
                </TouchableOpacity>
              </View>

            </SafeAreaView>
          </Modal>
        )}
      </SafeAreaView>
      
      {/* Add Song Modal */}
      <Modal
        visible={showAddSongModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddSongModal(false)}
      >
        <View style={styles.createAlbumModalOverlay}>
          <View style={styles.createAlbumModalContainer}>
            <Text style={styles.createAlbumModalTitle}>Add Song to Album</Text>
            
            {modalError ? <Text style={styles.modalErrorText}>{modalError}</Text> : null}
            
            <Text style={styles.inputLabel}>Search Song Title or Artist</Text>
            <TextInput
              style={styles.modalTextInput}
              placeholder="e.g. Blinding Lights"
              placeholderTextColor={COLORS.textMuted}
              value={songQuery}
              onChangeText={handleSongQueryChange}
              autoFocus={true}
            />

            <Text style={styles.inputLabel}>Suggestions</Text>
            <ScrollView style={styles.suggestionsListScroll} contentContainerStyle={{ paddingBottom: 10 }}>
              {songSuggestions.length === 0 ? (
                songQuery.trim().length >= SUGGESTION_MIN_CHARS ? (
                  <Text style={styles.noSuggestionsText}>No songs found.</Text>
                ) : (
                  <View style={styles.quickAddContainer}>
                    <Text style={styles.noSuggestionsText}>Start typing to search, or quick add recommendations:</Text>
                    {recommendations.slice(0, 4).map((rec, idx) => (
                      <TouchableOpacity 
                        key={idx}
                        style={styles.quickAddRow}
                        onPress={() => handleAddSongToAlbum(rec)}
                      >
                        <Image source={{ uri: rec.thumbnail }} style={styles.quickAddThumb} />
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={styles.quickAddTitle}>{rec.title}</Text>
                          <Text numberOfLines={1} style={styles.quickAddArtist}>{rec.artist}</Text>
                        </View>
                        <Text style={styles.quickAddPlus}>+</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )
              ) : (
                songSuggestions.map((s, idx) => (
                  <TouchableOpacity 
                    key={idx} 
                    style={styles.suggestionSearchItem}
                    onPress={() => handleAddSongToAlbum(s)}
                  >
                    <Image source={{ uri: s.thumbnail }} style={styles.suggestionSearchThumb} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.suggestionSearchTitle}>{s.title}</Text>
                      <Text numberOfLines={1} style={styles.suggestionSearchArtist}>{s.artist}</Text>
                    </View>
                    <Text style={styles.suggestionAddBtnSymbol}>+</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity 
                style={styles.modalCancelBtn} 
                onPress={() => setShowAddSongModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Album Modal */}
      <Modal
        visible={showCreateAlbumModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateAlbumModal(false)}
      >
        <View style={styles.createAlbumModalOverlay}>
          <View style={styles.createAlbumModalContainer}>
            <Text style={styles.createAlbumModalTitle}>Create New Album</Text>
            
            {modalError ? <Text style={styles.modalErrorText}>{modalError}</Text> : null}
            
            <Text style={styles.inputLabel}>Album Title</Text>
            <TextInput
              style={styles.modalTextInput}
              placeholder="e.g. Synthwave Dreams"
              placeholderTextColor={COLORS.textMuted}
              value={newAlbumTitle}
              onChangeText={setNewAlbumTitle}
            />
            
            <Text style={styles.inputLabel}>Release Year</Text>
            <TextInput
              style={styles.modalTextInput}
              placeholder="e.g. 2026"
              placeholderTextColor={COLORS.textMuted}
              value={newAlbumYear}
              onChangeText={setNewAlbumYear}
              keyboardType="numeric"
            />
            
            <Text style={styles.inputLabel}>Select Cover Art Preset</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetCoverScroll}>
              {ALBUM_PRESETS.map((preset, idx) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setNewAlbumCover(preset)}
                  style={[
                    styles.presetCoverTouch,
                    newAlbumCover === preset && styles.presetCoverTouchSelected
                  ]}
                >
                  <Image source={{ uri: preset }} style={styles.presetCoverImage} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            
            <Text style={styles.inputLabel}>Or paste cover image URL</Text>
            <TextInput
              style={styles.modalTextInput}
              placeholder="https://example.com/image.jpg"
              placeholderTextColor={COLORS.textMuted}
              value={newAlbumCover}
              onChangeText={setNewAlbumCover}
            />
            
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity 
                style={styles.modalCancelBtn} 
                onPress={() => setShowCreateAlbumModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.modalSaveBtn} 
                onPress={handleCreateAlbum}
              >
                <Text style={styles.modalSaveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaProvider>
  );
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollScreen: {
    flex: 1,
  },
  screenPadding: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  tabContentContainer: {
    flex: 1,
  },

  /* Artist Profile Banner Screen (Home tab) */
  artistHeaderContainer: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.32,
    position: 'relative',
  },
  artistBannerImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  artistBannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 16,
  },
  artistBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playlistBackButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  backButtonText: {
    color: COLORS.textLight,
    fontSize: 16,
    fontWeight: 'bold',
  },
  artistMetaInfo: {
    marginBottom: 4,
  },
  verifiedArtistText: {
    color: COLORS.teal,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.2,
  },
  artistNameText: {
    color: COLORS.textLight,
    fontSize: 32,
    fontWeight: 'bold',
    marginVertical: 4,
  },
  listenersText: {
    color: '#e5e7eb',
    fontSize: 13.5,
  },
  artistThreeDotsButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  threeDotsText: {
    color: COLORS.textLight,
    fontSize: 12,
    letterSpacing: 1.5,
  },

  /* Playlist View Screen (Library tab) */
  playlistHeaderContainer: {
    width: '100%',
    flexDirection: 'row',
    padding: 20,
    paddingTop: 24,
    gap: 16,
  },
  playlistCoverArtBig: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
  },
  playlistDetailsMetadataContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  playlistBigTitleHeader: {
    color: COLORS.textLight,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  playlistCuratorText: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginBottom: 4,
  },
  playlistCuratorHighlightText: {
    color: COLORS.cyan,
    fontWeight: '500',
  },
  playlistTracksDurationCountText: {
    color: COLORS.textMuted,
    fontSize: 13,
  },
  playlistControlsRowContainer: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  playlistPlayCircularButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playlistPlayIconArrowSymbol: {
    color: COLORS.teal,
    fontSize: 18,
    marginLeft: 3,
  },
  playlistTracksListContainer: {
    paddingHorizontal: 20,
  },
  playlistTrackRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  playlistTrackIndexNumberText: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginRight: 16,
    width: 20,
    textAlign: 'center',
  },
  playlistTrackThumbnailImage: {
    width: 46,
    height: 46,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    marginRight: 14,
  },
  playlistTrackMetaDetails: {
    flex: 1,
  },
  playlistTrackTitleLabelText: {
    color: COLORS.textLight,
    fontSize: 15,
    fontWeight: '500',
  },
  playlistTrackArtistLabelText: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  playlistTrackMoreOptionsButton: {
    padding: 8,
  },
  playlistTrackMoreOptionsBurgerSymbol: {
    color: COLORS.textMuted,
    fontSize: 14,
  },

  /* Search Screen (Search Tab) */
  searchScreenRoot: {
    flex: 1,
  },
  searchHeaderWrapper: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 12,
  },
  searchPageLargeTitle: {
    color: COLORS.textLight,
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  searchBarWrapperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16161a',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  searchGlassIcon: {
    color: '#6b7280',
    fontSize: 16,
    marginRight: 10,
  },
  searchBarTextInputField: {
    flex: 1,
    color: COLORS.textLight,
    fontSize: 15.5,
    height: '100%',
    padding: 0,
  },
  searchClearIconText: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginLeft: 6,
    padding: 4,
  },
  searchScrollableBody: {
    flex: 1,
  },
  browseAllGenresTitle: {
    color: COLORS.textLight,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  genresGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  genreCardItemContainer: {
    width: (SCREEN_WIDTH - 52) / 2,
    height: 110,
    borderRadius: 12,
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
    marginBottom: 4,
  },
  genreCardTitleLabel: {
    color: COLORS.textLight,
    fontSize: 16.5,
    fontWeight: 'bold',
  },
  genreCoverArtRotatedPeekContainer: {
    position: 'absolute',
    bottom: -15,
    right: -15,
    width: 72,
    height: 72,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  genreCoverArtRotatedPeekImage: {
    width: '100%',
    height: '100%',
    borderRadius: 6,
    transform: [{ rotate: '25deg' }],
  },

  /* Search Suggestions */
  searchSuggestionsListContainer: {
    paddingHorizontal: 20,
    marginTop: 8,
  },
  suggestionRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  suggestionItemHighlighted: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  suggestionThumbnailImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  placeholderArtworkBackground: {
    backgroundColor: COLORS.surface,
  },
  suggestionTextContainer: {
    flex: 1,
  },
  suggestionTitleTextLabel: {
    color: '#d4d4d8',
    fontSize: 14.5,
  },
  suggestionArtistTextLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  suggestionBoldTextHighlight: {
    fontWeight: 'bold',
    color: COLORS.textLight,
  },
  suggestionDurationText: {
    color: '#52525b',
    fontSize: 12,
  },

  /* Section Title Elements */
  sectionHeaderTitle: {
    color: COLORS.textLight,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  seeAllTextLink: {
    color: COLORS.textMuted,
    fontSize: 13,
  },

  /* Popular Tracks layout */
  popularTracksList: {
    marginBottom: 24,
  },
  popularTrackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101012',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  trackNumberIndex: {
    color: COLORS.textMuted,
    fontSize: 14,
    width: 24,
    textAlign: 'center',
    marginRight: 10,
  },
  trackThumbnailSmall: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    marginRight: 14,
  },
  popularTrackDetails: {
    flex: 1,
  },
  trackTitleText: {
    color: COLORS.textLight,
    fontSize: 14.5,
    fontWeight: '500',
  },
  trackPlaysText: {
    color: COLORS.textMuted,
    fontSize: 11.5,
    marginTop: 2,
  },
  playIconContainerOutline: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIconArrowSymbol: {
    color: COLORS.textLight,
    fontSize: 10,
    marginLeft: 1.5,
  },

  /* Album Cards list */
  albumsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  horizontalAlbumsScroll: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  albumCardItem: {
    width: 120,
    marginRight: 16,
  },
  albumCoverImage: {
    width: 120,
    height: 120,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    marginBottom: 8,
  },
  albumTitleText: {
    color: COLORS.textLight,
    fontSize: 13.5,
    fontWeight: '500',
  },
  albumYearText: {
    color: COLORS.textMuted,
    fontSize: 11.5,
    marginTop: 2,
  },

  /* Floating Mini Player Styles */
  miniPlayerBarContainer: {
    position: 'absolute',
    bottom: 64, // Just above bottom tab bar
    left: 12,
    right: 12,
    height: 58,
    borderRadius: 12,
    backgroundColor: '#111115',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 50,
  },
  miniPlayerArtworkImage: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
  },
  miniPlayerDetailsContainer: {
    flex: 1,
    marginLeft: 12,
  },
  miniPlayerSongTitleText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '500',
  },
  miniPlayerSongArtistText: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  miniPlayerPlayPauseButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniPlayerPlayPauseIconSymbol: {
    color: COLORS.teal,
    fontSize: 18,
    fontWeight: 'bold',
  },

  /* Bottom Tab Navigation Bar */
  bottomNavigationTabBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: '#0a0a0d',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 6,
    zIndex: 40,
  },
  navigationTabItemButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 70,
    height: '100%',
  },
  navigationTabItemIcon: {
    color: COLORS.textMuted,
    fontSize: 22,
  },
  navigationTabItemIconActive: {
    color: COLORS.teal,
  },
  navigationTabItemLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  navigationTabItemLabelActive: {
    color: COLORS.teal,
    fontWeight: '500',
  },

  /* Full Screen Now Playing - Screen 4 */
  fullPlayerScreenRoot: {
    flex: 1,
    backgroundColor: '#070708',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  fullPlayerHeaderRowContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    height: 56,
  },
  fullPlayerChevronDownButton: {
    padding: 8,
  },
  fullPlayerChevronDownSymbol: {
    color: COLORS.textLight,
    fontSize: 16,
  },
  fullPlayerHeaderTitleText: {
    color: COLORS.textLight,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  fullPlayerHeaderBurgerMenuButton: {
    padding: 8,
  },
  fullPlayerHeaderBurgerMenuSymbol: {
    color: COLORS.textLight,
    fontSize: 16,
  },
  fullPlayerArtworkGlowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: SCREEN_HEIGHT * 0.02,
    shadowColor: COLORS.cyan,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 24,
  },
  fullPlayerArtworkBigImage: {
    width: SCREEN_WIDTH * 0.8,
    height: SCREEN_WIDTH * 0.8,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
  },
  fullPlayerSongDetailsRowContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginVertical: 12,
  },
  fullPlayerSongTextWrapper: {
    flex: 1,
    marginRight: 16,
  },
  fullPlayerSongTitleText: {
    color: COLORS.textLight,
    fontSize: 22,
    fontWeight: 'bold',
  },
  fullPlayerSongArtistText: {
    color: COLORS.cyan,
    fontSize: 14,
    marginTop: 4,
    fontWeight: '500',
  },
  fullPlayerLikeHeartButton: {
    padding: 8,
  },
  fullPlayerHeartIconSymbol: {
    color: COLORS.textMuted,
    fontSize: 24,
  },
  fullPlayerHeartIconActive: {
    color: COLORS.cyan,
  },

  /* Custom Touch Seeker Slider */
  fullPlayerSeekSliderContainer: {
    paddingHorizontal: 32,
    marginVertical: 8,
  },
  fullPlayerSeekSliderHitbox: {
    width: '100%',
    paddingVertical: 12,
  },
  fullPlayerSeekSliderTrackBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    position: 'relative',
  },
  fullPlayerSeekSliderFillBar: {
    height: '100%',
    backgroundColor: COLORS.teal, // Accent color matching gradient fill request
    borderRadius: 2,
  },
  fullPlayerSeekSliderThumbCircle: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.textLight,
    top: -4,
    marginLeft: -6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  fullPlayerTimeIndicatorsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  fullPlayerTimeLabelText: {
    color: COLORS.textMuted,
    fontSize: 12.5,
  },

  /* Playback Controls Row */
  fullPlayerPlaybackControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginVertical: 12,
  },
  fullPlayerPrimaryControlBtn: {
    padding: 10,
  },
  fullPlayerSecondaryControlBtn: {
    padding: 10,
  },
  fullPlayerControlBtnSymbol: {
    color: COLORS.textMuted,
    fontSize: 22,
  },
  fullPlayerControlBtnActive: {
    color: COLORS.cyan,
  },
  fullPlayerCircularPlayPauseGradientButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.teal,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.teal,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  fullPlayerCircularPlayPauseTextSymbol: {
    color: COLORS.textDark,
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 2.5,
  },

  /* Volume Row Slider */
  fullPlayerVolumeRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginVertical: 16,
    gap: 12,
  },
  fullPlayerVolumeSpeakerIconSymbol: {
    color: COLORS.textMuted,
    fontSize: 16,
  },
  fullPlayerVolumeSliderHitbox: {
    flex: 1,
    paddingVertical: 10,
  },
  fullPlayerVolumeSliderTrackBar: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 1.5,
    position: 'relative',
  },
  fullPlayerVolumeSliderFillBar: {
    height: '100%',
    backgroundColor: COLORS.cyan,
    borderRadius: 1.5,
  },
  fullPlayerVolumeSliderThumbCircle: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.textLight,
    top: -3.5,
    marginLeft: -5,
  },
  fullPlayerLyricsListTriggerButton: {
    padding: 8,
  },
  fullPlayerLyricsListSymbol: {
    color: COLORS.textMuted,
    fontSize: 16,
  },

  /* Create Album Header Button */
  createAlbumHeaderBtn: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cyan,
    backgroundColor: 'rgba(169, 248, 251, 0.05)',
  },
  createAlbumHeaderBtnText: {
    color: COLORS.teal,
    fontSize: 12,
    fontWeight: 'bold',
  },

  /* Empty State Placeholder styling */
  albumPlaceholderContainer: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: '#0c0c0e',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
    marginHorizontal: 4,
  },
  albumPlaceholderIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  albumPlaceholderText: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginBottom: 12,
  },
  albumPlaceholderBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: COLORS.teal,
  },
  albumPlaceholderBtnText: {
    color: COLORS.textDark,
    fontSize: 12,
    fontWeight: 'bold',
  },

  /* Create Album Modal overlay styling */
  createAlbumModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  createAlbumModalContainer: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#121214',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  createAlbumModalTitle: {
    color: COLORS.textLight,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalErrorText: {
    color: '#ef4444',
    fontSize: 12,
    marginBottom: 10,
    textAlign: 'center',
  },
  inputLabel: {
    color: COLORS.lavender,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    marginTop: 10,
  },
  modalTextInput: {
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  presetCoverScroll: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  presetCoverTouch: {
    marginRight: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  presetCoverTouchSelected: {
    borderColor: COLORS.teal,
  },
  presetCoverImage: {
    width: 60,
    height: 60,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  modalSaveBtn: {
    flex: 1,
    backgroundColor: COLORS.teal,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    shadowColor: COLORS.teal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
      modalSaveBtnText: {
      color: COLORS.textDark,
      fontSize: 14,
      fontWeight: 'bold',
    },

    /* Album Song Management styling */
    addSongBtn: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: COLORS.cyan,
      backgroundColor: 'rgba(169, 248, 251, 0.05)',
      marginLeft: 16,
    },
    addSongBtnText: {
      color: COLORS.teal,
      fontSize: 13,
      fontWeight: 'bold',
    },
    albumSongsPlaceholder: {
      padding: 30,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 20,
    },
    albumTrackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    },
    albumTrackClickableArea: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    removeTrackBtn: {
      padding: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    removeTrackBtnText: {
      color: '#ef4444',
      fontSize: 16,
    },

    /* Add Song picker suggestion items styling */
    suggestionsListScroll: {
      maxHeight: 240,
      marginTop: 6,
    },
    noSuggestionsText: {
      color: COLORS.textMuted,
      fontSize: 12,
      textAlign: 'center',
      marginVertical: 16,
      paddingHorizontal: 10,
    },
    quickAddContainer: {
      gap: 8,
    },
    quickAddRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#1c1c1f',
      padding: 8,
      borderRadius: 8,
      gap: 10,
    },
    quickAddThumb: {
      width: 36,
      height: 36,
      borderRadius: 4,
    },
    quickAddTitle: {
      color: '#ffffff',
      fontSize: 13,
      fontWeight: '500',
    },
    quickAddArtist: {
      color: COLORS.textMuted,
      fontSize: 11,
    },
    quickAddPlus: {
      color: COLORS.teal,
      fontSize: 18,
      paddingHorizontal: 8,
      fontWeight: 'bold',
    },
    suggestionSearchItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#1c1c1f',
      padding: 10,
      borderRadius: 8,
      marginVertical: 4,
      gap: 12,
    },
    suggestionSearchThumb: {
      width: 40,
      height: 40,
      borderRadius: 4,
    },
    suggestionSearchTitle: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: '500',
    },
    suggestionSearchArtist: {
      color: COLORS.textMuted,
      fontSize: 12,
    },
      suggestionAddBtnSymbol: {
    color: COLORS.teal,
    fontSize: 20,
    paddingHorizontal: 8,
    fontWeight: 'bold',
  },

  /* Recent Searches Styles */
  recentSearchesContainer: {
    marginBottom: 24,
    paddingTop: 10,
  },
  recentSearchesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  recentSearchesTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  clearAllHistoryText: {
    color: COLORS.teal,
    fontSize: 12,
    fontWeight: '600',
  },
  recentSearchesList: {
    gap: 8,
  },
  recentSearchItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  recentSearchTextClickable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recentSearchHistoryIcon: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  recentSearchText: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '500',
  },
  removeRecentItemBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeRecentItemSymbol: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: 'bold',
  },

  /* Autocomplete Predictive Styles */
  ghostText: {
    position: 'absolute',
    left: 38,
    right: 48,
    fontSize: 15.5,
    color: 'transparent',
    height: 48,
    lineHeight: 48,
    padding: 0,
  },
  autocompleteBtn: {
    padding: 4,
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  autocompleteBtnText: {
    color: COLORS.teal,
    fontSize: 18,
    fontWeight: 'bold',
  },
});
