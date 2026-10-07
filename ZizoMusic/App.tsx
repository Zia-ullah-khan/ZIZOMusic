import React, { useState, useEffect, useRef } from "react";
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
  ActivityIndicator,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  AppKilledPlaybackBehavior,
} from "react-native-track-player";
import { API_URL, apiFetch, ensureSession, safeImageUrl } from "./api";
import {
  PlayIcon,
  PauseIcon,
  SkipNextIcon,
  SkipPrevIcon,
  ShuffleIcon,
  RepeatIcon,
  HeartIcon,
  HomeIcon,
  SearchIcon,
  LibraryIcon,
  VolumeIcon,
  QueueIcon,
  CloseIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  TrashIcon,
  PlusIcon,
  ClockIcon,
  DiscIcon,
  MusicIcon,
  RetryIcon,
  LyricsIcon,
} from "./components/Icons";

interface LibraryTrack
{
  title: string;
  artist: string;
  thumbnail: string;
  query: string;
  videoId?: string;
}

type Recommendation = LibraryTrack;

interface SongInfo
{
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

interface Suggestion
{
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: string;
  score: number;
}

interface Album
{
  id: string;
  title: string;
  year: string;
  thumbnail: string;
  songs: LibraryTrack[];
}

type TabId = "home" | "search" | "library";
type LibraryView = "root" | "liked" | "history" | "album";
type PlayStatus = "idle" | "finding" | "buffering" | "playing" | "paused" | "error";
type LyricsStatus = "ok" | "instrumental" | "missing";

interface LyricLine
{
  time: number;
  text: string;
}

interface LyricsData
{
  status: LyricsStatus;
  synced: boolean;
  lines: LyricLine[];
}

const ALBUM_PRESETS = [
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300",
  "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300",
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300",
  "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=300",
];

const GENRES = [
  { title: "Synthwave", color: "#DEC5E3", thumb: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150" },
  { title: "Lo-Fi Beats", color: "#81F7E5", thumb: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150" },
  { title: "Techno & Club", color: "#A9F8FB", thumb: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150" },
  { title: "Indie Rock", color: "#FF9F1C", thumb: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150" },
  { title: "Hip-Hop", color: "#EC4899", thumb: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150" },
  { title: "Chill Ambient", color: "#3B82F6", thumb: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=150" },
];

const STORAGE = {
  recent: "recentTracks",
  liked: "likedTracks",
  albums: "createdAlbums",
  prefs: "playbackPrefs",
  session: "lastSession",
  legacyRecent: "recentSongs",
};

const UPCOMING_QUEUE_SIZE = 2;
const SUGGESTION_DEBOUNCE_MS = 220;
const SUGGESTION_MIN_CHARS = 2;

const COLORS = {
  lavender: "#DEC5E3",
  cyan: "#A9F8FB",
  teal: "#81F7E5",
  background: "#070708",
  surface: "#121214",
  surfaceLight: "#1c1c1f",
  textMuted: "#9ca3af",
  textLight: "#ffffff",
  textDark: "#000000",
};

function normalizeTrackText(value: unknown): string
{
  if (typeof value === "string")
  {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean")
  {
    return String(value).trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "title" in value)
  {
    return normalizeTrackText((value as { title?: unknown }).title);
  }
  return "";
}

function trackKey(track: { title?: unknown; artist?: unknown; query?: unknown }): string
{
  const queryText = normalizeTrackText(track.query);
  const fallbackText = [normalizeTrackText(track.title), normalizeTrackText(track.artist)].filter(Boolean).join(" ").trim();
  return (queryText || fallbackText).trim();
}

function asTrack(input: unknown, queryOverride?: string): LibraryTrack
{
  if (typeof input === "string")
  {
    const text = input.trim();
    return { title: text, artist: "", thumbnail: "", query: text };
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
  {
    return { title: "", artist: "", thumbnail: "", query: normalizeTrackText(queryOverride) };
  }
  const source = input as Record<string, unknown>;
  if (source.title && typeof source.title === "object" && !Array.isArray(source.title))
  {
    return asTrack(source.title, queryOverride || normalizeTrackText(source.query));
  }
  const title = normalizeTrackText(source.title);
  const artist = normalizeTrackText(source.artist);
  const query = normalizeTrackText(queryOverride) || normalizeTrackText(source.query) || `${title} ${artist}`.trim();
  return {
    title,
    artist,
    thumbnail: safeImageUrl(typeof source.thumbnail === "string" ? source.thumbnail : ""),
    query,
  };
}

function coerceTrackList(raw: unknown): LibraryTrack[]
{
  if (!Array.isArray(raw))
  {
    return [];
  }
  return raw.map((item) => asTrack(item)).filter((item) => item.title || item.query);
}

function formatTime(seconds: number): string
{
  if (!seconds || seconds < 0 || !isFinite(seconds))
  {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function activeLyricIndex(lines: LyricLine[], time: number, synced: boolean): number
{
  if (!synced || lines.length === 0)
  {
    return -1;
  }

  let index = 0;
  for (let i = 0; i < lines.length; i++)
  {
    if (lines[i].time <= time + 0.12)
    {
      index = i;
    }
    else
    {
      break;
    }
  }

  return index;
}

function asLyricsData(input: unknown): LyricsData
{
  if (!input || typeof input !== "object")
  {
    return { status: "missing", synced: false, lines: [] };
  }

  const data = input as { status?: unknown; synced?: unknown; lines?: unknown };
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines: LyricLine[] = [];

  for (const entry of rawLines)
  {
    if (!entry || typeof entry !== "object")
    {
      continue;
    }

    const line = entry as { time?: unknown; text?: unknown };
    const text = typeof line.text === "string" ? line.text.trim() : "";
    if (!text)
    {
      continue;
    }

    const time = typeof line.time === "number" && Number.isFinite(line.time) ? line.time : 0;
    lines.push({ time, text });
  }

  const status: LyricsStatus = data.status === "ok" || data.status === "instrumental"
    ? data.status
    : "missing";

  return {
    status: lines.length > 0 ? "ok" : (status === "instrumental" ? "instrumental" : "missing"),
    synced: Boolean(data.synced) && lines.some((line) => line.time > 0),
    lines,
  };
}

function lyricsRequestPath(title: string, artist: string, query: string, duration: number): string
{
  const params = new URLSearchParams();
  if (title)
  {
    params.set("title", title);
  }
  if (artist)
  {
    params.set("artist", artist);
  }
  if (query)
  {
    params.set("q", query);
  }
  if (duration > 0)
  {
    params.set("duration", String(Math.round(duration)));
  }

  return `/lyrics?${params.toString()}`;
}

function greetingForHour(hour: number): string
{
  if (hour < 12)
  {
    return "Good morning";
  }
  if (hour < 18)
  {
    return "Good afternoon";
  }
  return "Good evening";
}

function shuffleArray<T>(items: T[]): T[]
{
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--)
  {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

interface ResolvedStream
{
  url: string;
  type?: TrackType;
}

const resolveStream = async (songName: string): Promise<ResolvedStream> =>
{
  const res = await apiFetch(`/play/${encodeURIComponent(songName)}`);
  if (!res.ok)
  {
    throw new Error(`Play resolve failed: ${res.status}`);
  }
  const data = await res.json();
  if (typeof data.url !== "string" || (!data.url.startsWith("/hls/") && !data.url.startsWith("/stream/")))
  {
    throw new Error("Invalid stream URL");
  }
  return {
    url: `${API_URL}${data.url}`,
    type: data.type === "hls" ? TrackType.HLS : undefined,
  };
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

const setupPlayer = async () =>
{
  try
  {
    await TrackPlayer.setupPlayer({
      minBuffer: 15,
      maxBuffer: 90,
      playBuffer: 1.5,
      backBuffer: 10,
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
  }
  catch (error)
  {
    console.log("Player already setup", error);
  }
};

function Cover({ uri, style, size = 44 }: { uri?: string; style?: any; size?: number })
{
  const safe = safeImageUrl(uri);
  if (!safe)
  {
    return (
      <View style={[style, styles.coverFallback]}>
        <MusicIcon size={size * 0.4} color={COLORS.textMuted} />
      </View>
    );
  }
  return <Image source={{ uri: safe }} style={style} />;
}

function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
})
{
  return (
    <View style={styles.emptyState}>
      <View style={{ marginBottom: 10 }}>{icon}</View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.primaryPill} onPress={onAction}>
          <Text style={styles.primaryPillText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SkeletonRow()
{
  return (
    <View style={styles.skeletonRow}>
      <View style={styles.skeletonArt} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[styles.skeletonLine, { width: "70%" }]} />
        <View style={[styles.skeletonLine, { width: "40%", height: 8 }]} />
      </View>
    </View>
  );
}

export default function App()
{
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

function AppShell()
{
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [libraryView, setLibraryView] = useState<LibraryView>("root");
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isShuffled, setIsShuffled] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isAutoplay, setIsAutoplay] = useState(true);
  const [likedTracks, setLikedTracks] = useState<LibraryTrack[]>([]);
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [activeAlbum, setActiveAlbum] = useState<Album | null>(null);
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [showAddSongModal, setShowAddSongModal] = useState(false);
  const [albumToDelete, setAlbumToDelete] = useState<Album | null>(null);
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [newAlbumYear, setNewAlbumYear] = useState("");
  const [newAlbumCover, setNewAlbumCover] = useState(ALBUM_PRESETS[0]);
  const [modalError, setModalError] = useState("");
  const [playStatus, setPlayStatus] = useState<PlayStatus>("idle");
  const [recentTracks, setRecentTracks] = useState<LibraryTrack[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [recsError, setRecsError] = useState(false);
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [songQuery, setSongQuery] = useState("");
  const [songSuggestions, setSongSuggestions] = useState<Suggestion[]>([]);
  const [playList, setPlayList] = useState<LibraryTrack[]>([]);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState(0);

  const playbackState = usePlaybackState();
  const progress = useProgress(250);
  const insets = useSafeAreaInsets();

  const recommendationsRef = useRef(recommendations);
  const playListRef = useRef(playList);
  const isAutoplayRef = useRef(isAutoplay);
  const isShuffledRef = useRef(isShuffled);
  const isPlayerReadyRef = useRef(isPlayerReady);
  const lastQueryRef = useRef("");
  const sliderWidthRef = useRef(1);
  const volumeSliderWidthRef = useRef(1);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionRequestIdRef = useRef(0);
  const songSuggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDurationSyncRef = useRef("");
  const pendingSeekRef = useRef<number | null>(null);
  const lyricsRequestIdRef = useRef(0);
  const lyricsScrollRef = useRef<ScrollView | null>(null);
  const lyricLineYRef = useRef<number[]>([]);
  const lyricsUserScrollRef = useRef(false);
  const lyricsScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressDurationRef = useRef(0);

  recommendationsRef.current = recommendations;
  playListRef.current = playList;
  isAutoplayRef.current = isAutoplay;
  isShuffledRef.current = isShuffled;
  isPlayerReadyRef.current = isPlayerReady;
  progressDurationRef.current = progress.duration;

  const likedKeys = new Set(likedTracks.map(trackKey));
  const isPlaying = playbackState.state === State.Playing;
  const isBusy = playStatus === "finding" || playbackState.state === State.Buffering || playbackState.state === State.Connecting;
  const displayedPosition = isSeeking ? seekPreview : progress.position;
  const sliderRatio = progress.duration > 0 ? Math.max(0, Math.min(1, displayedPosition / progress.duration)) : 0;
  const lyricIndex = lyrics ? activeLyricIndex(lyrics.lines, displayedPosition, lyrics.synced) : -1;
  const displaySong = currentSong ? asTrack(currentSong, lastQueryRef.current) : null;
  const continueTrack = displaySong || (recentTracks[0] ? asTrack(recentTracks[0]) : null);
  const currentKey = displaySong ? trackKey(displaySong) : "";
  const currentLiked = displaySong ? likedKeys.has(currentKey) || likedKeys.has(displaySong.title) : false;
  const greeting = greetingForHour(new Date().getHours());
  const ghostText = (() =>
  {
    if (suggestions.length === 0 || !query.trim())
    {
      return "";
    }
    const topTitle = suggestions[0].title;
    if (topTitle.toLowerCase().startsWith(query.toLowerCase()))
    {
      return query + topTitle.slice(query.length);
    }
    return "";
  })();

  const upcomingTracks = (): LibraryTrack[] =>
  {
    const source = playList.length > 0 ? playList : recommendations;
    return source.filter((item) => trackKey(item) !== lastQueryRef.current).slice(0, 8);
  };

  useEffect(() =>
  {
    const init = async () =>
    {
      await setupPlayer();
      setIsPlayerReady(true);

      try
      {
        const storedRecent = await AsyncStorage.getItem(STORAGE.recent);
        const legacyRecent = await AsyncStorage.getItem(STORAGE.legacyRecent);
        const storedLiked = await AsyncStorage.getItem(STORAGE.liked);
        const storedAlbums = await AsyncStorage.getItem(STORAGE.albums);
        const storedPrefs = await AsyncStorage.getItem(STORAGE.prefs);
        const storedSession = await AsyncStorage.getItem(STORAGE.session);

        if (storedRecent)
        {
          setRecentTracks(coerceTrackList(JSON.parse(storedRecent)));
        }
        else if (legacyRecent)
        {
          setRecentTracks(coerceTrackList(JSON.parse(legacyRecent)));
        }

        if (storedLiked)
        {
          setLikedTracks(coerceTrackList(JSON.parse(storedLiked)));
        }

        if (storedAlbums)
        {
          const parsed = JSON.parse(storedAlbums);
          if (Array.isArray(parsed))
          {
            setAlbums(parsed.map((album: any, index: number) => ({
              id: album.id || `migrated-${index}`,
              title: normalizeTrackText(album.title),
              year: normalizeTrackText(album.year),
              thumbnail: typeof album.thumbnail === "string" ? album.thumbnail : "",
              songs: coerceTrackList(album.songs),
            })));
          }
        }

        if (storedPrefs)
        {
          const prefs = JSON.parse(storedPrefs);
          if (typeof prefs.volume === "number")
          {
            setVolume(prefs.volume);
            await TrackPlayer.setVolume(prefs.volume);
          }
          if (typeof prefs.isLooping === "boolean")
          {
            setIsLooping(prefs.isLooping);
            await TrackPlayer.setRepeatMode(prefs.isLooping ? RepeatMode.Track : RepeatMode.Off);
          }
          if (typeof prefs.isShuffled === "boolean")
          {
            setIsShuffled(prefs.isShuffled);
          }
          if (typeof prefs.isAutoplay === "boolean")
          {
            setIsAutoplay(prefs.isAutoplay);
          }
        }

        if (storedSession)
        {
          const session = JSON.parse(storedSession);
          if (session?.track)
          {
            const restored = asTrack(session.track);
            setCurrentSong(restored);
            lastQueryRef.current = restored.query;
            pendingSeekRef.current = session.position || 0;
            setPlayStatus("paused");
          }
        }

        await ensureSession();
        fetchRecommendations();
      }
      catch (error)
      {
        console.error("Failed to load storage", error);
        fetchRecommendations();
      }
    };
    init();
  }, []);

  useEffect(() =>
  {
    AsyncStorage.setItem(STORAGE.prefs, JSON.stringify({
      volume,
      isLooping,
      isShuffled,
      isAutoplay,
    })).catch(() => {});
  }, [volume, isLooping, isShuffled, isAutoplay]);

  useEffect(() =>
  {
    if (!currentSong)
    {
      lyricsRequestIdRef.current += 1;
      setLyrics(null);
      setLyricsLoading(false);
      return;
    }

    const requestId = ++lyricsRequestIdRef.current;
    const restored = asTrack(currentSong, lastQueryRef.current);
    const title = restored.title;
    const artist = restored.artist;
    const query = restored.query || `${title} ${artist}`.trim();
    const durationHint = (currentSong.duration && currentSong.duration > 0)
      ? currentSong.duration
      : progressDurationRef.current;

    setLyrics(null);
    setLyricsLoading(true);
    lyricsUserScrollRef.current = false;
    lyricLineYRef.current = [];

    apiFetch(lyricsRequestPath(title, artist, query, durationHint), {}, 2)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
      {
        if (requestId !== lyricsRequestIdRef.current)
        {
          return;
        }
        setLyrics(asLyricsData(data));
        setLyricsLoading(false);
      })
      .catch(() =>
      {
        if (requestId !== lyricsRequestIdRef.current)
        {
          return;
        }
        setLyrics({ status: "missing", synced: false, lines: [] });
        setLyricsLoading(false);
      });
  }, [currentSong]);

  useEffect(() =>
  {
    if (!showLyrics || !showFullPlayer || lyricIndex < 0 || lyricsUserScrollRef.current)
    {
      return;
    }

    const y = lyricLineYRef.current[lyricIndex];
    if (y == null)
    {
      return;
    }

    lyricsScrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: true });
  }, [lyricIndex, showLyrics, showFullPlayer]);

  const fetchRecommendations = async () =>
  {
    setRecsLoading(true);
    setRecsError(false);
    try
    {
      const res = await apiFetch("/recommend?limit=12");
      if (res.ok)
      {
        const data = await res.json();
        setRecommendations(coerceTrackList(data.recommendations));
      }
      else
      {
        setRecsError(true);
      }
    }
    catch (error)
    {
      console.error("Failed to fetch recommendations", error);
      setRecsError(true);
    }
    finally
    {
      setRecsLoading(false);
    }
  };

  const addToHistory = (track: LibraryTrack) =>
  {
    setRecentTracks((prev) =>
    {
      const next = [track, ...prev.filter((item) => trackKey(item) !== trackKey(track))].slice(0, 20);
      AsyncStorage.setItem(STORAGE.recent, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const removeRecentTrack = (track: LibraryTrack) =>
  {
    setRecentTracks((prev) =>
    {
      const next = prev.filter((item) => trackKey(item) !== trackKey(track));
      AsyncStorage.setItem(STORAGE.recent, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const clearRecentTracks = () =>
  {
    setRecentTracks([]);
    AsyncStorage.multiRemove([STORAGE.recent, STORAGE.legacyRecent]).catch(() => {});
  };

  const saveAlbums = (next: Album[]) =>
  {
    setAlbums(next);
    AsyncStorage.setItem(STORAGE.albums, JSON.stringify(next)).catch(() => {});
  };

  const persistSession = (song: SongInfo | null, position: number) =>
  {
    if (!song)
    {
      AsyncStorage.removeItem(STORAGE.session).catch(() => {});
      return;
    }
    AsyncStorage.setItem(STORAGE.session, JSON.stringify({
      track: asTrack(song, lastQueryRef.current || trackKey(song)),
      position,
    })).catch(() => {});
  };

  const enqueueUpcoming = async (excludeId: string, source?: LibraryTrack[]) =>
  {
    const queue = await TrackPlayer.getQueue();
    const queuedIds = new Set(queue.map((track) => String(track.id)));
    let upcoming = (source && source.length > 0 ? source : recommendationsRef.current)
      .filter((rec) => rec.query && rec.query !== excludeId && !queuedIds.has(rec.query));
    if (isShuffledRef.current)
    {
      upcoming = shuffleArray(upcoming);
    }
    upcoming = upcoming.slice(0, UPCOMING_QUEUE_SIZE);

    for (const rec of upcoming)
    {
      try
      {
        const stream = await resolveStream(rec.query);
        await TrackPlayer.add(toPlayerTrack(rec.query, rec, stream));
      }
      catch (error)
      {
        console.error("Failed to enqueue upcoming", error);
      }
    }
  };

  const topUpQueue = async () =>
  {
    const queue = await TrackPlayer.getQueue();
    const index = await TrackPlayer.getActiveTrackIndex();
    if (index == null)
    {
      return;
    }
    const remaining = queue.length - index - 1;
    if (remaining >= 2)
    {
      return;
    }
    const active = queue[index];
    await enqueueUpcoming(String(active?.id || ""), playListRef.current);
  };

  const syncTrackDuration = async () =>
  {
    const progressNow = await TrackPlayer.getProgress();
    const index = await TrackPlayer.getActiveTrackIndex();
    const active = await TrackPlayer.getActiveTrack();
    if (index == null || !active || progressNow.duration <= 0)
    {
      return;
    }
    const key = `${active.id}:${Math.round(progressNow.duration)}`;
    if (lastDurationSyncRef.current === key)
    {
      return;
    }
    lastDurationSyncRef.current = key;
    await TrackPlayer.updateMetadataForTrack(index, { duration: progressNow.duration });
  };

  const playSong = async (songInput: string | LibraryTrack | Recommendation, list?: LibraryTrack[]) =>
  {
    if (!isPlayerReadyRef.current)
    {
      return;
    }
    clearSuggestions();

    let track: LibraryTrack;
    let infoPromise: Promise<SongInfo | null> | null = null;

    if (typeof songInput === "string")
    {
      if (!songInput.trim())
      {
        return;
      }
      track = { title: songInput.trim(), artist: "", thumbnail: "", query: songInput.trim() };
      infoPromise = apiFetch(`/info/${encodeURIComponent(track.query)}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    }
    else
    {
      track = asTrack(songInput);
    }

    lastQueryRef.current = track.query;
    setQuery(track.query);
    setCurrentSong(track);
    setPlayStatus("finding");
    addToHistory(track);
    setRecommendations((prev) => prev.filter((item) => item.query !== track.query));

    const extras = list && list.length > 0
      ? list.map((item) => asTrack(item))
      : recommendationsRef.current.map((item) => asTrack(item));
    const rest = extras.filter((item) => trackKey(item) !== trackKey(track));
    setPlayList(isShuffledRef.current ? [track, ...shuffleArray(rest)] : [track, ...rest]);

    try
    {
      const stream = await resolveStream(track.query);
      await TrackPlayer.reset();
      await TrackPlayer.add(toPlayerTrack(track.query, track, stream));
      await TrackPlayer.play();
      if (pendingSeekRef.current)
      {
        await TrackPlayer.seekTo(pendingSeekRef.current);
        pendingSeekRef.current = null;
      }
      setPlayStatus("playing");
      enqueueUpcoming(track.query, extras).catch((error) => console.error("Failed to enqueue upcoming", error));
    }
    catch (error)
    {
      console.error("Error playing song:", error);
      setPlayStatus("error");
    }

    if (infoPromise)
    {
      infoPromise.then((info) =>
      {
        if (!info)
        {
          return;
        }
        const resolved = asTrack(info, track.query);
        setCurrentSong({
          ...resolved,
          duration: typeof info.duration === "number" ? info.duration : undefined,
        });
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
    [Event.PlaybackActiveTrackChanged, Event.PlaybackQueueEnded, Event.PlaybackProgressUpdated, Event.PlaybackError],
    async (event) =>
    {
      if (event.type === Event.PlaybackActiveTrackChanged)
      {
        const track = event.track;
        if (!track)
        {
          return;
        }
        const songName = String(track.id || track.title || "");
        const nextSong = {
          title: String(track.title || songName),
          artist: String(track.artist || "ZIZO Music"),
          thumbnail: typeof track.artwork === "string" ? track.artwork : "",
        };
        setCurrentSong(nextSong);
        setPlayStatus("playing");
        if (songName)
        {
          lastQueryRef.current = songName;
          setQuery(songName);
          addToHistory(asTrack(nextSong, songName));
          setRecommendations((prev) => prev.filter((item) => item.query !== songName));
        }
        await topUpQueue();
        await syncTrackDuration();
      }

      if (event.type === Event.PlaybackProgressUpdated)
      {
        await syncTrackDuration();
        const active = await TrackPlayer.getActiveTrack();
        if (active)
        {
          persistSession({
            title: String(active.title || ""),
            artist: String(active.artist || ""),
            thumbnail: typeof active.artwork === "string" ? active.artwork : "",
          }, event.position);
        }
      }

      if (event.type === Event.PlaybackQueueEnded && isAutoplayRef.current)
      {
        const upcoming = upcomingTracks()[0];
        if (upcoming)
        {
          playSong(upcoming, playListRef.current.length ? playListRef.current : recommendationsRef.current);
        }
      }

      if (event.type === Event.PlaybackError)
      {
        const active = await TrackPlayer.getActiveTrack();
        const progressNow = await TrackPlayer.getProgress();
        const songName = String(active?.id || "");
        if (!songName)
        {
          setPlayStatus("error");
          return;
        }
        try
        {
          const stream = await resolveStream(songName);
          const index = await TrackPlayer.getActiveTrackIndex();
          if (index == null)
          {
            return;
          }
          await TrackPlayer.remove(index);
          await TrackPlayer.add(toPlayerTrack(songName, {
            title: String(active?.title || songName),
            artist: String(active?.artist || "ZIZO Music"),
            thumbnail: typeof active?.artwork === "string" ? active.artwork : "",
          }, stream), index);
          await TrackPlayer.skip(index);
          if (progressNow.position > 2)
          {
            await TrackPlayer.seekTo(progressNow.position);
          }
          await TrackPlayer.play();
          setPlayStatus("playing");
        }
        catch (error)
        {
          console.error("Playback recover failed", error);
          setPlayStatus("error");
        }
      }
    }
  );

  const toggleLoop = async () =>
  {
    const next = !isLooping;
    setIsLooping(next);
    await TrackPlayer.setRepeatMode(next ? RepeatMode.Track : RepeatMode.Off);
  };

  const toggleShuffle = () =>
  {
    setIsShuffled(!isShuffled);
  };

  const togglePlayback = async () =>
  {
    const queue = await TrackPlayer.getQueue();
    if (queue.length === 0 && currentSong)
    {
      await playSong(asTrack(currentSong, lastQueryRef.current));
      return;
    }
    const state = await TrackPlayer.getPlaybackState();
    if (state.state === State.Playing)
    {
      await TrackPlayer.pause();
      setPlayStatus("paused");
    }
    else
    {
      await TrackPlayer.play();
      setPlayStatus("playing");
    }
  };

  const toggleLike = async (song: SongInfo | LibraryTrack) =>
  {
    const track = asTrack(song, "query" in song ? song.query : lastQueryRef.current);
    const key = trackKey(track);
    const exists = likedTracks.some((item) => trackKey(item) === key);
    const next = exists ? likedTracks.filter((item) => trackKey(item) !== key) : [track, ...likedTracks];
    setLikedTracks(next);
    await AsyncStorage.setItem(STORAGE.liked, JSON.stringify(next));
  };

  const skipNext = async () =>
  {
    try
    {
      const queue = await TrackPlayer.getQueue();
      const index = await TrackPlayer.getActiveTrackIndex();
      if (index != null && index < queue.length - 1)
      {
        await TrackPlayer.skipToNext();
        return;
      }
    }
    catch (error)
    {
      console.error(error);
    }
    const next = upcomingTracks()[0];
    if (next)
    {
      await playSong(next, playListRef.current.length ? playListRef.current : recommendationsRef.current);
    }
  };

  const skipPrevious = async () =>
  {
    try
    {
      const index = await TrackPlayer.getActiveTrackIndex();
      const progressNow = await TrackPlayer.getProgress();
      if (progressNow.position > 3)
      {
        await TrackPlayer.seekTo(0);
        return;
      }
      if (index != null && index > 0)
      {
        await TrackPlayer.skip(index - 1);
        return;
      }
    }
    catch (error)
    {
      console.error(error);
    }
  };

  const positionForSlider = (event: GestureResponderEvent) =>
  {
    const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / sliderWidthRef.current));
    return ratio * (progress.duration || 0);
  };

  const onSliderGrant = (event: GestureResponderEvent) =>
  {
    if (progress.duration <= 0)
    {
      return;
    }
    setIsSeeking(true);
    setSeekPreview(positionForSlider(event));
  };

  const onSliderMove = (event: GestureResponderEvent) =>
  {
    if (!isSeeking || progress.duration <= 0)
    {
      return;
    }
    setSeekPreview(positionForSlider(event));
  };

  const onSliderRelease = async (event: GestureResponderEvent) =>
  {
    if (progress.duration <= 0)
    {
      setIsSeeking(false);
      return;
    }
    const nextPosition = positionForSlider(event);
    setSeekPreview(nextPosition);
    try
    {
      await TrackPlayer.seekTo(nextPosition);
    }
    catch (error)
    {
      console.error("Seek failed", error);
    }
    setIsSeeking(false);
  };

  const seekToLyric = async (time: number) =>
  {
    if (!Number.isFinite(time))
    {
      return;
    }
    lyricsUserScrollRef.current = false;
    try
    {
      await TrackPlayer.seekTo(time);
    }
    catch (error)
    {
      console.error("Lyric seek failed", error);
    }
  };

  const markLyricsUserScroll = () =>
  {
    lyricsUserScrollRef.current = true;
    if (lyricsScrollTimerRef.current)
    {
      clearTimeout(lyricsScrollTimerRef.current);
    }
    lyricsScrollTimerRef.current = setTimeout(() =>
    {
      lyricsUserScrollRef.current = false;
    }, 2500);
  };

  const volumeForSlider = (event: GestureResponderEvent) =>
    Math.max(0, Math.min(1, event.nativeEvent.locationX / volumeSliderWidthRef.current));

  const onVolumeGrant = async (event: GestureResponderEvent) =>
  {
    const next = volumeForSlider(event);
    setVolume(next);
    await TrackPlayer.setVolume(next);
  };

  const canSkipNext = upcomingTracks().length > 0;
  const canSkipPrev = displayedPosition > 3;

  const handleCreateAlbum = async () =>
  {
    if (!newAlbumTitle.trim())
    {
      setModalError("Please enter an album title.");
      return;
    }
    const album: Album = {
      id: Date.now().toString(),
      title: newAlbumTitle.trim(),
      year: newAlbumYear.trim() || new Date().getFullYear().toString(),
      thumbnail: safeImageUrl(newAlbumCover.trim()) || ALBUM_PRESETS[0],
      songs: [],
    };
    saveAlbums([album, ...albums]);
    setNewAlbumTitle("");
    setNewAlbumYear("");
    setNewAlbumCover(ALBUM_PRESETS[0]);
    setModalError("");
    setShowCreateAlbumModal(false);
    setActiveAlbum(album);
    setLibraryView("album");
    setActiveTab("library");
  };

  const confirmDeleteAlbum = () =>
  {
    if (!albumToDelete)
    {
      return;
    }
    const next = albums.filter((album) => album.id !== albumToDelete.id);
    saveAlbums(next);
    if (activeAlbum?.id === albumToDelete.id)
    {
      setActiveAlbum(null);
      setLibraryView("root");
    }
    setAlbumToDelete(null);
  };

  const handleAddSongToAlbum = (song: LibraryTrack | Suggestion | Recommendation) =>
  {
    if (!activeAlbum)
    {
      return;
    }
    const track = asTrack(song);
    if (activeAlbum.songs.some((item) => trackKey(item) === trackKey(track)))
    {
      setModalError("This song is already in the album.");
      return;
    }
    const updated = { ...activeAlbum, songs: [...activeAlbum.songs, track] };
    setActiveAlbum(updated);
    saveAlbums(albums.map((album) => (album.id === updated.id ? updated : album)));
    setSongQuery("");
    setSongSuggestions([]);
    setModalError("");
    setShowAddSongModal(false);
  };

  const handleRemoveSongFromAlbum = (track: LibraryTrack) =>
  {
    if (!activeAlbum)
    {
      return;
    }
    const updated = { ...activeAlbum, songs: activeAlbum.songs.filter((item) => trackKey(item) !== trackKey(track)) };
    setActiveAlbum(updated);
    saveAlbums(albums.map((album) => (album.id === updated.id ? updated : album)));
  };

  const clearSuggestions = () =>
  {
    if (suggestionTimerRef.current)
    {
      clearTimeout(suggestionTimerRef.current);
    }
    suggestionRequestIdRef.current += 1;
    setSuggestions([]);
    setSearchLoading(false);
    setSearchError(false);
    setHighlightedIndex(0);
  };

  const fetchSuggestions = async (text: string) =>
  {
    const requestId = ++suggestionRequestIdRef.current;
    setSearchLoading(true);
    setSearchError(false);
    try
    {
      const res = await apiFetch(`/search/suggestions?q=${encodeURIComponent(text)}&limit=8`);
      if (requestId !== suggestionRequestIdRef.current)
      {
        return;
      }
      if (!res.ok)
      {
        setSearchError(true);
        setSuggestions([]);
        return;
      }
      const data = await res.json();
      setSuggestions(data.suggestions || []);
      setHighlightedIndex(0);
    }
    catch (error)
    {
      if (requestId === suggestionRequestIdRef.current)
      {
        console.error(error);
        setSearchError(true);
      }
    }
    finally
    {
      if (requestId === suggestionRequestIdRef.current)
      {
        setSearchLoading(false);
      }
    }
  };

  const handleQueryChange = (text: string) =>
  {
    setQuery(text);
    if (suggestionTimerRef.current)
    {
      clearTimeout(suggestionTimerRef.current);
    }
    if (text.trim().length < SUGGESTION_MIN_CHARS)
    {
      clearSuggestions();
      return;
    }
    suggestionTimerRef.current = setTimeout(() => fetchSuggestions(text.trim()), SUGGESTION_DEBOUNCE_MS);
  };

  const playSuggestion = (suggestion: Suggestion) =>
  {
    const track = asTrack(suggestion);
    playSong(track, [track, ...recommendations]);
    setSuggestions([]);
    setQuery("");
  };

  const onSearchSubmit = () =>
  {
    if (suggestions.length > 0)
    {
      playSuggestion(suggestions[Math.min(highlightedIndex, suggestions.length - 1)]);
      return;
    }
    if (query.trim())
    {
      playSong(query.trim());
    }
  };

  const fetchSongSuggestions = async (text: string) =>
  {
    try
    {
      const res = await apiFetch(`/search/suggestions?q=${encodeURIComponent(text)}&limit=5`);
      if (res.ok)
      {
        const data = await res.json();
        setSongSuggestions(data.suggestions || []);
      }
    }
    catch (error)
    {
      console.error(error);
    }
  };

  const handleSongQueryChange = (text: string) =>
  {
    setSongQuery(text);
    if (songSuggestionTimerRef.current)
    {
      clearTimeout(songSuggestionTimerRef.current);
    }
    if (text.trim().length < SUGGESTION_MIN_CHARS)
    {
      setSongSuggestions([]);
      return;
    }
    songSuggestionTimerRef.current = setTimeout(() => fetchSongSuggestions(text.trim()), SUGGESTION_DEBOUNCE_MS);
  };

  const selectGenre = (genre: string) =>
  {
    setActiveTab("search");
    setQuery(genre);
    fetchSuggestions(genre);
  };

  const goHome = () =>
  {
    setActiveTab("home");
    setLibraryView("root");
    setActiveAlbum(null);
    clearSuggestions();
  };

  const openAlbum = (album: Album) =>
  {
    setActiveAlbum(album);
    setLibraryView("album");
    setActiveTab("library");
  };

  const renderTrackRow = (track: LibraryTrack, options?: { index?: number; onRemove?: () => void; list?: LibraryTrack[] }) =>
  {
    const playingHere = currentKey !== "" && trackKey(track) === currentKey;
    return (
      <View key={`${trackKey(track)}-${options?.index ?? 0}`} style={[styles.trackRow, playingHere && styles.trackRowActive]}>
        <TouchableOpacity style={styles.trackRowMain} onPress={() => playSong(track, options?.list)} accessibilityLabel={`Play ${track.title}`}>
          {options?.index != null ? (
            <Text style={styles.trackIndex}>{String(options.index + 1).padStart(2, "0")}</Text>
          ) : null}
          <Cover uri={track.thumbnail} style={styles.trackThumb} />
          <View style={styles.trackMeta}>
            <Text numberOfLines={1} style={[styles.trackTitle, playingHere && { color: COLORS.teal }]}>{track.title}</Text>
            <Text numberOfLines={1} style={styles.trackArtist}>{track.artist || "Unknown artist"}</Text>
          </View>
          <PlayIcon size={16} color={COLORS.teal} />
        </TouchableOpacity>
        {options?.onRemove ? (
          <TouchableOpacity onPress={options.onRemove} accessibilityLabel="Remove" style={styles.iconHit}>
            <TrashIcon size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const playerStatusLabel = playStatus === "finding"
    ? "Finding track"
    : isBusy
      ? "Buffering"
      : playStatus === "error"
        ? "Couldn't play this track"
        : "";

  const tabBarHeight = 64 + insets.bottom;
  const bottomPad = (currentSong ? 148 : 80) + insets.bottom;

  return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={styles.tabContentContainer}>
          {activeTab === "home" && (
            <ScrollView style={styles.scrollScreen} contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 20, paddingTop: 16 }}>
              <Text style={styles.wordmark}>ZIZO Music</Text>
              <Text style={styles.pageTitle}>{greeting}</Text>
              <Text style={styles.pageSubtitle}>Pick up where you left off, or find something new.</Text>

              {continueTrack ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Continue listening</Text>
                  <TouchableOpacity style={styles.continueCard} onPress={() => playSong(continueTrack, recentTracks)}>
                    <Cover uri={continueTrack.thumbnail} style={styles.continueArt} size={72} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.trackTitleLarge}>{continueTrack.title}</Text>
                      <Text numberOfLines={1} style={styles.trackArtist}>{continueTrack.artist || "Unknown artist"}</Text>
                    </View>
                    <View style={styles.playCircle}>
                      <PlayIcon size={18} color={COLORS.textDark} />
                    </View>
                  </TouchableOpacity>
                </View>
              ) : null}

              {recentTracks.length > 0 ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Recently played</Text>
                    <TouchableOpacity onPress={() => { setActiveTab("library"); setLibraryView("history"); }}>
                      <Text style={styles.seeAll}>See all</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {recentTracks.slice(0, 10).map((track) => (
                      <TouchableOpacity key={trackKey(track)} style={styles.recentCard} onPress={() => playSong(track, recentTracks)}>
                        <Cover uri={track.thumbnail} style={styles.recentArt} size={120} />
                        <Text numberOfLines={1} style={styles.cardTitle}>{track.title}</Text>
                        <Text numberOfLines={1} style={styles.cardMeta}>{track.artist}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recommended for you</Text>
                {recsLoading ? <><SkeletonRow /><SkeletonRow /><SkeletonRow /></> : null}
                {!recsLoading && recsError ? (
                  <EmptyState icon={<RetryIcon size={28} color={COLORS.teal} />} title="Couldn't load recommendations" body="Check your connection and try again." actionLabel="Retry" onAction={fetchRecommendations} />
                ) : null}
                {!recsLoading && !recsError && recommendations.length === 0 ? (
                  <EmptyState icon={<SearchIcon size={28} color={COLORS.teal} />} title="Nothing queued yet" body="Search for a song and we'll start building recommendations around what you play." actionLabel="Search" onAction={() => setActiveTab("search")} />
                ) : null}
                {!recsLoading && !recsError ? recommendations.slice(0, 8).map((track, index) => renderTrackRow(track, { index, list: recommendations })) : null}
              </View>

              {albums.length > 0 ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Your albums</Text>
                    <TouchableOpacity onPress={() => { setActiveTab("library"); setLibraryView("root"); }}>
                      <Text style={styles.seeAll}>See all</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {albums.map((album) => (
                      <TouchableOpacity key={album.id} style={styles.recentCard} onPress={() => openAlbum(album)}>
                        <Cover uri={album.thumbnail} style={styles.recentArt} size={120} />
                        <Text numberOfLines={1} style={styles.cardTitle}>{album.title}</Text>
                        <Text style={styles.cardMeta}>{album.year}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Browse genres</Text>
                <View style={styles.genreGrid}>
                  {GENRES.map((genre) => (
                    <TouchableOpacity key={genre.title} style={[styles.genreCard, { backgroundColor: genre.color }]} onPress={() => selectGenre(genre.title)}>
                      <Text style={styles.genreTitle}>{genre.title}</Text>
                      <Image source={{ uri: genre.thumb }} style={styles.genreThumb} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>
          )}

          {activeTab === "search" && (
            <View style={{ flex: 1 }}>
              <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
                <Text style={styles.pageTitle}>Search</Text>
                <View style={styles.searchBar}>
                  <SearchIcon size={16} color={COLORS.textMuted} />
                  {ghostText ? (
                    <Text style={styles.ghostText} pointerEvents="none" numberOfLines={1}>
                      <Text style={{ color: "transparent" }}>{query}</Text>
                      <Text style={{ color: "rgba(255,255,255,0.35)" }}>{ghostText.slice(query.length)}</Text>
                    </Text>
                  ) : null}
                  <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={handleQueryChange}
                    placeholder="Songs or artists"
                    placeholderTextColor="#6b7280"
                    onSubmitEditing={onSearchSubmit}
                    accessibilityLabel="Search songs or artists"
                    returnKeyType="search"
                  />
                  {query.length > 0 ? (
                    <TouchableOpacity onPress={() => { setQuery(""); clearSuggestions(); }} accessibilityLabel="Clear search">
                      <CloseIcon size={14} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
              <ScrollView contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 20, paddingTop: 12 }}>
                {searchLoading ? <><SkeletonRow /><SkeletonRow /><SkeletonRow /></> : null}
                {!searchLoading && searchError ? (
                  <EmptyState icon={<RetryIcon size={28} color={COLORS.teal} />} title="Search didn't go through" body="We couldn't reach results for that query." actionLabel="Retry" onAction={() => fetchSuggestions(query.trim())} />
                ) : null}
                {!searchLoading && !searchError && query.trim().length >= SUGGESTION_MIN_CHARS && suggestions.length === 0 ? (
                  <EmptyState icon={<SearchIcon size={28} color={COLORS.teal} />} title={`No songs match “${query.trim()}”`} body="Try a different spelling, or search by artist name." />
                ) : null}
                {!searchLoading && suggestions.map((suggestion, index) => (
                  <TouchableOpacity
                    key={suggestion.id}
                    style={[styles.trackRow, index === highlightedIndex && styles.trackRowActive]}
                    onPress={() => playSuggestion(suggestion)}
                  >
                    <Cover uri={suggestion.thumbnail} style={styles.trackThumb} />
                    <View style={styles.trackMeta}>
                      <Text numberOfLines={1} style={styles.trackTitle}>{suggestion.title}</Text>
                      <Text numberOfLines={1} style={styles.trackArtist}>{suggestion.artist}</Text>
                    </View>
                    {suggestion.duration ? <Text style={styles.duration}>{suggestion.duration}</Text> : null}
                  </TouchableOpacity>
                ))}
                {!searchLoading && query.trim().length < SUGGESTION_MIN_CHARS ? (
                  <>
                    {recentTracks.length > 0 ? (
                      <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                          <Text style={styles.sectionTitle}>Recent searches</Text>
                          <TouchableOpacity onPress={clearRecentTracks}><Text style={styles.seeAllTeal}>Clear all</Text></TouchableOpacity>
                        </View>
                        {recentTracks.slice(0, 8).map((track) => (
                          <View key={trackKey(track)} style={styles.recentSearchRow}>
                            <TouchableOpacity style={styles.trackRowMain} onPress={() => { setQuery(track.query); handleQueryChange(track.query); }}>
                              <ClockIcon size={16} color={COLORS.textMuted} />
                              <Text numberOfLines={1} style={[styles.trackTitle, { marginLeft: 12 }]}>{track.title}{track.artist ? ` · ${track.artist}` : ""}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => removeRecentTrack(track)} accessibilityLabel="Remove from history" style={styles.iconHit}>
                              <CloseIcon size={14} color={COLORS.textMuted} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <Text style={styles.sectionTitle}>Browse all genres</Text>
                    <View style={styles.genreGrid}>
                      {GENRES.map((genre) => (
                        <TouchableOpacity key={genre.title} style={[styles.genreCard, { backgroundColor: genre.color }]} onPress={() => selectGenre(genre.title)}>
                          <Text style={styles.genreTitle}>{genre.title}</Text>
                          <Image source={{ uri: genre.thumb }} style={styles.genreThumb} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
              </ScrollView>
            </View>
          )}

          {activeTab === "library" && libraryView === "album" && activeAlbum && (
            <ScrollView contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 20, paddingTop: 16 }}>
              <TouchableOpacity style={styles.backBtn} onPress={() => { setLibraryView("root"); setActiveAlbum(null); }} accessibilityLabel="Back to library">
                <ChevronLeftIcon size={18} color={COLORS.textLight} />
              </TouchableOpacity>
              <View style={styles.albumHeader}>
                <Cover uri={activeAlbum.thumbnail} style={styles.albumHero} size={160} />
                <Text style={styles.pageTitle}>{activeAlbum.title}</Text>
                <Text style={styles.pageSubtitle}>Album · {activeAlbum.year}</Text>
                <Text style={styles.cardMeta}>{activeAlbum.songs.length} {activeAlbum.songs.length === 1 ? "track" : "tracks"}</Text>
              </View>
              <View style={styles.rowActions}>
                <TouchableOpacity
                  style={[styles.playCircle, activeAlbum.songs.length === 0 && { opacity: 0.4 }]}
                  disabled={activeAlbum.songs.length === 0}
                  onPress={() => playSong(activeAlbum.songs[0], activeAlbum.songs)}
                  accessibilityLabel="Play album"
                >
                  <PlayIcon size={20} color={COLORS.textDark} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.outlinePill} onPress={() => { setSongQuery(""); setSongSuggestions([]); setModalError(""); setShowAddSongModal(true); }}>
                  <Text style={styles.outlinePillText}>Add songs</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setAlbumToDelete(activeAlbum)} accessibilityLabel="Delete album" style={styles.iconHit}>
                  <TrashIcon size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
              {activeAlbum.songs.length === 0 ? (
                <EmptyState icon={<MusicIcon size={28} color={COLORS.teal} />} title="This album is empty" body="Add songs from search so you can play them in order." actionLabel="Add songs" onAction={() => setShowAddSongModal(true)} />
              ) : activeAlbum.songs.map((track, index) => renderTrackRow(track, { index, list: activeAlbum.songs, onRemove: () => handleRemoveSongFromAlbum(track) }))}
            </ScrollView>
          )}

          {activeTab === "library" && libraryView === "liked" && (
            <ScrollView contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 20, paddingTop: 16 }}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setLibraryView("root")} accessibilityLabel="Back to library">
                <ChevronLeftIcon size={18} color={COLORS.textLight} />
              </TouchableOpacity>
              <Text style={styles.pageTitle}>Liked songs</Text>
              {likedTracks.length === 0 ? (
                <EmptyState icon={<HeartIcon size={28} color={COLORS.teal} />} title="No liked songs yet" body="Tap the heart on a track while it's playing to save it here." />
              ) : (
                <>
                  <TouchableOpacity style={[styles.playCircle, { marginVertical: 16 }]} onPress={() => playSong(likedTracks[0], likedTracks)} accessibilityLabel="Play liked songs">
                    <PlayIcon size={20} color={COLORS.textDark} />
                  </TouchableOpacity>
                  {likedTracks.map((track, index) => renderTrackRow(track, { index, list: likedTracks }))}
                </>
              )}
            </ScrollView>
          )}

          {activeTab === "library" && libraryView === "history" && (
            <ScrollView contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 20, paddingTop: 16 }}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setLibraryView("root")} accessibilityLabel="Back to library">
                <ChevronLeftIcon size={18} color={COLORS.textLight} />
              </TouchableOpacity>
              <View style={styles.sectionHeader}>
                <Text style={styles.pageTitle}>Recently played</Text>
                {recentTracks.length > 0 ? (
                  <TouchableOpacity onPress={clearRecentTracks}><Text style={styles.seeAllTeal}>Clear all</Text></TouchableOpacity>
                ) : null}
              </View>
              {recentTracks.length === 0 ? (
                <EmptyState icon={<ClockIcon size={28} color={COLORS.teal} />} title="No listening history" body="Songs you play will show up here." />
              ) : recentTracks.map((track, index) => renderTrackRow(track, { index, list: recentTracks, onRemove: () => removeRecentTrack(track) }))}
            </ScrollView>
          )}

          {activeTab === "library" && libraryView === "root" && (
            <ScrollView contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 20, paddingTop: 16 }}>
              <Text style={styles.pageTitle}>Your library</Text>
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Liked songs</Text>
                  {likedTracks.length > 0 ? (
                    <TouchableOpacity onPress={() => setLibraryView("liked")}><Text style={styles.seeAll}>See all</Text></TouchableOpacity>
                  ) : null}
                </View>
                {likedTracks.length === 0 ? (
                  <Text style={styles.pageSubtitle}>Hearts you tap while listening are saved here.</Text>
                ) : likedTracks.slice(0, 5).map((track, index) => renderTrackRow(track, { index, list: likedTracks }))}
              </View>
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Albums</Text>
                  <TouchableOpacity
                    style={styles.createPill}
                    onPress={() =>
                    {
                      setNewAlbumTitle("");
                      setNewAlbumYear("");
                      setNewAlbumCover(ALBUM_PRESETS[0]);
                      setModalError("");
                      setShowCreateAlbumModal(true);
                    }}
                  >
                    <PlusIcon size={14} color={COLORS.textDark} />
                    <Text style={styles.createPillText}>Create</Text>
                  </TouchableOpacity>
                </View>
                {albums.length === 0 ? (
                  <EmptyState icon={<DiscIcon size={28} color={COLORS.teal} />} title="No albums yet" body="Create an album and add songs you want to keep together." actionLabel="Create album" onAction={() => setShowCreateAlbumModal(true)} />
                ) : (
                  <View style={styles.albumGrid}>
                    {albums.map((album) => (
                      <TouchableOpacity key={album.id} style={styles.albumGridItem} onPress={() => openAlbum(album)}>
                        <Cover uri={album.thumbnail} style={styles.albumGridArt} size={160} />
                        <Text numberOfLines={1} style={styles.cardTitle}>{album.title}</Text>
                        <Text style={styles.cardMeta}>{album.songs.length} tracks · {album.year}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Recently played</Text>
                  {recentTracks.length > 0 ? (
                    <TouchableOpacity onPress={() => setLibraryView("history")}><Text style={styles.seeAll}>See all</Text></TouchableOpacity>
                  ) : null}
                </View>
                {recentTracks.length === 0 ? (
                  <Text style={styles.pageSubtitle}>Your last plays will land here.</Text>
                ) : recentTracks.slice(0, 5).map((track, index) => renderTrackRow(track, { index, list: recentTracks }))}
              </View>
            </ScrollView>
          )}
        </View>

        {currentSong && !showFullPlayer ? (
          <TouchableOpacity style={[styles.miniPlayer, { bottom: tabBarHeight }]} onPress={() => setShowFullPlayer(true)} activeOpacity={0.9}>
            <View>
              <Cover uri={currentSong.thumbnail} style={styles.miniArt} />
              {isBusy ? (
                <View style={styles.busyOverlay}><ActivityIndicator color="#fff" size="small" /></View>
              ) : null}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text numberOfLines={1} style={styles.trackTitle}>{displaySong?.title}</Text>
              <Text numberOfLines={1} style={styles.trackArtist}>
                {playStatus === "error" ? "Could not play this track" : displaySong?.artist || playerStatusLabel}
              </Text>
            </View>
            {playStatus === "error" ? (
              <TouchableOpacity onPress={() => playSong(asTrack(currentSong, lastQueryRef.current))} accessibilityLabel="Retry" style={styles.iconHit}>
                <RetryIcon size={18} color={COLORS.teal} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={togglePlayback} accessibilityLabel={isPlaying ? "Pause" : "Play"} style={styles.iconHit}>
                {isPlaying ? <PauseIcon size={18} color={COLORS.teal} /> : <PlayIcon size={18} color={COLORS.teal} />}
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ) : null}

        <View style={[styles.tabBar, { height: tabBarHeight, paddingBottom: insets.bottom }]}>
          {[
            { id: "home" as const, label: "Home", icon: HomeIcon, action: goHome },
            { id: "search" as const, label: "Search", icon: SearchIcon, action: () => { setActiveTab("search"); setActiveAlbum(null); } },
            { id: "library" as const, label: "Library", icon: LibraryIcon, action: () => { setActiveTab("library"); setLibraryView("root"); setActiveAlbum(null); clearSuggestions(); } },
          ].map((item) =>
          {
            const active = activeTab === item.id;
            const Icon = item.icon;
            return (
              <TouchableOpacity key={item.id} style={styles.tabItem} onPress={item.action} accessibilityLabel={item.label}>
                <Icon size={20} color={active ? COLORS.teal : COLORS.textMuted} />
                <Text style={[styles.tabLabel, active && { color: COLORS.teal }]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Modal visible={showFullPlayer} animationType="slide" onRequestClose={() => setShowFullPlayer(false)}>
          <SafeAreaView style={styles.fullPlayer}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
            <View style={styles.fullHeader}>
              <TouchableOpacity onPress={() => setShowFullPlayer(false)} accessibilityLabel="Close now playing" style={styles.iconHit}>
                <ChevronDownIcon size={22} color={COLORS.textLight} />
              </TouchableOpacity>
              <Text style={styles.nowPlayingLabel}>{showLyrics ? "LYRICS" : "NOW PLAYING"}</Text>
              <View style={styles.fullHeaderActions}>
                <TouchableOpacity
                  onPress={() => setShowLyrics(!showLyrics)}
                  accessibilityLabel={showLyrics ? "Hide lyrics" : "Show lyrics"}
                  style={styles.iconHit}
                >
                  <LyricsIcon size={20} color={showLyrics ? COLORS.teal : COLORS.textLight} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowQueue(true)} accessibilityLabel="Queue" style={styles.iconHit}>
                  <QueueIcon size={20} color={COLORS.textLight} />
                </TouchableOpacity>
              </View>
            </View>
            {showLyrics ? (
              <View style={styles.lyricsWrap}>
                {lyricsLoading ? (
                  <View style={styles.lyricsEmpty}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.lyricsEmptyText}>Finding lyrics</Text>
                  </View>
                ) : lyrics?.status === "instrumental" ? (
                  <View style={styles.lyricsEmpty}>
                    <Text style={styles.lyricsEmptyText}>This track is instrumental.</Text>
                  </View>
                ) : lyrics?.status === "ok" && lyrics.lines.length > 0 ? (
                  <ScrollView
                    ref={lyricsScrollRef}
                    style={styles.lyricsScroll}
                    contentContainerStyle={styles.lyricsContent}
                    showsVerticalScrollIndicator={false}
                    onScrollBeginDrag={markLyricsUserScroll}
                    onMomentumScrollBegin={markLyricsUserScroll}
                  >
                    {lyrics.lines.map((line, index) =>
                    {
                      const active = lyrics.synced && index === lyricIndex;
                      const past = lyrics.synced && index < lyricIndex;
                      return (
                        <TouchableOpacity
                          key={`${index}-${line.time}-${line.text}`}
                          activeOpacity={lyrics.synced ? 0.7 : 1}
                          onPress={() => lyrics.synced && seekToLyric(line.time)}
                          onLayout={(event) => { lyricLineYRef.current[index] = event.nativeEvent.layout.y; }}
                          disabled={!lyrics.synced}
                        >
                          <Text
                            style={[
                              styles.lyricLine,
                              !lyrics.synced && styles.lyricLinePlain,
                              past && styles.lyricLinePast,
                              active && styles.lyricLineActive,
                            ]}
                          >
                            {typeof line.text === "string" ? line.text : ""}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <View style={styles.lyricsEmpty}>
                    <Text style={styles.lyricsEmptyText}>Lyrics are not available for this track.</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.artworkWrap}>
                <Cover uri={currentSong?.thumbnail} style={styles.fullArt} size={280} />
                {isBusy ? (
                  <View style={[styles.busyOverlay, { borderRadius: 16 }]}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.busyLabel}>{playerStatusLabel}</Text>
                  </View>
                ) : null}
              </View>
            )}
            <View style={styles.fullMeta}>
              <View style={{ flex: 1, marginRight: 16 }}>
                <Text numberOfLines={1} style={styles.fullTitle}>{displaySong?.title}</Text>
                <Text numberOfLines={1} style={styles.fullArtist}>{displaySong?.artist || "ZIZO Music"}</Text>
              </View>
              <TouchableOpacity onPress={() => currentSong && toggleLike(currentSong)} accessibilityLabel={currentLiked ? "Unlike" : "Like"}>
                <HeartIcon size={22} color={currentLiked ? COLORS.teal : COLORS.textMuted} filled={currentLiked} />
              </TouchableOpacity>
            </View>
            {playStatus === "error" ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>Couldn't play this track.</Text>
                <TouchableOpacity onPress={() => currentSong && playSong(asTrack(currentSong, lastQueryRef.current))}>
                  <Text style={styles.seeAllTeal}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={styles.seekWrap}>
              <View
                style={styles.sliderHit}
                onLayout={(event) => { sliderWidthRef.current = event.nativeEvent.layout.width; }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={onSliderGrant}
                onResponderMove={onSliderMove}
                onResponderRelease={onSliderRelease}
                accessibilityLabel="Seek"
              >
                <View style={styles.sliderTrack}>
                  <View style={[styles.sliderFill, { width: `${sliderRatio * 100}%` }]} />
                  <View style={[styles.sliderThumb, { left: `${sliderRatio * 100}%` }]} />
                </View>
              </View>
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(displayedPosition)}</Text>
                <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
              </View>
            </View>
            <View style={styles.controlsRow}>
              <TouchableOpacity onPress={toggleShuffle} accessibilityLabel="Shuffle">
                <ShuffleIcon size={20} color={isShuffled ? COLORS.teal : COLORS.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={skipPrevious} accessibilityLabel="Previous" disabled={!canSkipPrev && displayedPosition <= 3}>
                <SkipPrevIcon size={24} color={COLORS.textLight} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.playCircleLarge}
                onPress={playStatus === "error" && currentSong ? () => playSong(asTrack(currentSong, lastQueryRef.current)) : togglePlayback}
                accessibilityLabel={isPlaying ? "Pause" : "Play"}
              >
                {playStatus === "error" ? <RetryIcon size={26} color={COLORS.textDark} /> : isBusy ? <ActivityIndicator color={COLORS.textDark} /> : isPlaying ? <PauseIcon size={28} color={COLORS.textDark} /> : <PlayIcon size={28} color={COLORS.textDark} />}
              </TouchableOpacity>
              <TouchableOpacity onPress={skipNext} accessibilityLabel="Next" disabled={!canSkipNext}>
                <SkipNextIcon size={24} color={canSkipNext ? COLORS.textLight : "#444"} />
              </TouchableOpacity>
              <TouchableOpacity onPress={toggleLoop} accessibilityLabel="Repeat">
                <RepeatIcon size={20} color={isLooping ? COLORS.teal : COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.volumeRow}>
              <VolumeIcon size={16} color={COLORS.textMuted} isMuted={volume === 0} />
              <View
                style={styles.sliderHitFlex}
                onLayout={(event) => { volumeSliderWidthRef.current = event.nativeEvent.layout.width; }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={onVolumeGrant}
                onResponderMove={onVolumeGrant}
                accessibilityLabel="Volume"
              >
                <View style={styles.volumeTrack}>
                  <View style={[styles.volumeFill, { width: `${volume * 100}%` }]} />
                  <View style={[styles.volumeThumb, { left: `${volume * 100}%` }]} />
                </View>
              </View>
            </View>
          </SafeAreaView>
        </Modal>

        <Modal visible={showQueue} animationType="slide" transparent onRequestClose={() => setShowQueue(false)}>
          <View style={styles.sheetOverlay}>
            <View style={styles.sheet}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Up next</Text>
                <TouchableOpacity onPress={() => setShowQueue(false)} accessibilityLabel="Close queue">
                  <CloseIcon size={18} color={COLORS.textLight} />
                </TouchableOpacity>
              </View>
              {currentSong ? (
                <>
                  <Text style={styles.kicker}>Playing</Text>
                  {renderTrackRow(asTrack(currentSong, lastQueryRef.current))}
                </>
              ) : null}
              {upcomingTracks().length === 0 ? (
                <Text style={[styles.pageSubtitle, { textAlign: "center", marginTop: 24 }]}>Nothing else in the queue. Play a list or keep autoplay on for recommendations.</Text>
              ) : upcomingTracks().map((track, index) => renderTrackRow(track, { index, list: playList.length ? playList : recommendations }))}
            </View>
          </View>
        </Modal>

        <Modal visible={showAddSongModal} animationType="slide" transparent onRequestClose={() => setShowAddSongModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add song to album</Text>
              {modalError ? <Text style={styles.modalError}>{modalError}</Text> : null}
              <TextInput
                style={styles.modalInput}
                placeholder="Search title or artist"
                placeholderTextColor={COLORS.textMuted}
                value={songQuery}
                onChangeText={handleSongQueryChange}
                autoFocus
              />
              <ScrollView style={{ maxHeight: 240 }}>
                {(songSuggestions.length > 0 ? songSuggestions : recommendations.slice(0, 4)).map((item, index) => (
                  <TouchableOpacity key={index} style={styles.addRow} onPress={() => handleAddSongToAlbum(item as any)}>
                    <Cover uri={item.thumbnail} style={styles.addThumb} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.trackTitle}>{item.title}</Text>
                      <Text numberOfLines={1} style={styles.trackArtist}>{item.artist}</Text>
                    </View>
                    <PlusIcon size={16} color={COLORS.teal} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity onPress={() => setShowAddSongModal(false)}><Text style={styles.modalCancel}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={showCreateAlbumModal} animationType="slide" transparent onRequestClose={() => setShowCreateAlbumModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Create album</Text>
              {modalError ? <Text style={styles.modalError}>{modalError}</Text> : null}
              <Text style={styles.inputLabel}>Album title</Text>
              <TextInput style={styles.modalInput} placeholder="e.g. Night drives" placeholderTextColor={COLORS.textMuted} value={newAlbumTitle} onChangeText={setNewAlbumTitle} />
              <Text style={styles.inputLabel}>Year</Text>
              <TextInput style={styles.modalInput} placeholder={new Date().getFullYear().toString()} placeholderTextColor={COLORS.textMuted} value={newAlbumYear} onChangeText={setNewAlbumYear} keyboardType="numeric" />
              <Text style={styles.inputLabel}>Cover</Text>
              <ScrollView horizontal>
                {ALBUM_PRESETS.map((preset) => (
                  <TouchableOpacity key={preset} onPress={() => setNewAlbumCover(preset)} style={[styles.preset, newAlbumCover === preset && styles.presetSelected]}>
                    <Image source={{ uri: preset }} style={styles.presetImage} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput style={styles.modalInput} placeholder="Or paste a cover image URL" placeholderTextColor={COLORS.textMuted} value={ALBUM_PRESETS.includes(newAlbumCover) ? "" : newAlbumCover} onChangeText={setNewAlbumCover} />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalGhost} onPress={() => setShowCreateAlbumModal(false)}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={styles.primaryPill} onPress={handleCreateAlbum}><Text style={styles.primaryPillText}>Save</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={!!albumToDelete} transparent animationType="fade" onRequestClose={() => setAlbumToDelete(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Delete album?</Text>
              <Text style={[styles.pageSubtitle, { textAlign: "center" }]}>
                “{albumToDelete?.title}” and its track list will be removed from this device. This cannot be undone.
              </Text>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalGhost} onPress={() => setAlbumToDelete(null)}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={styles.deletePill} onPress={confirmDeleteAlbum}><Text style={styles.deletePillText}>Delete</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  tabContentContainer: { flex: 1 },
  scrollScreen: { flex: 1 },
  wordmark: { color: COLORS.textLight, fontSize: 16, fontWeight: "600", marginBottom: 18 },
  pageTitle: { color: COLORS.textLight, fontSize: 32, fontWeight: "700", letterSpacing: -0.6 },
  pageSubtitle: { color: COLORS.textMuted, fontSize: 14, marginTop: 6, marginBottom: 8 },
  section: { marginTop: 28 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sectionTitle: { color: COLORS.textLight, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  seeAll: { color: COLORS.textMuted, fontSize: 14 },
  seeAllTeal: { color: COLORS.teal, fontSize: 14, fontWeight: "600" },
  continueCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#101012", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 16, padding: 12 },
  continueArt: { width: 72, height: 72, borderRadius: 12, backgroundColor: COLORS.surface },
  trackTitleLarge: { color: COLORS.textLight, fontSize: 16, fontWeight: "600" },
  playCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.teal, alignItems: "center", justifyContent: "center" },
  playCircleLarge: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.teal, alignItems: "center", justifyContent: "center" },
  recentCard: { width: 120, marginRight: 12 },
  recentArt: { width: 120, height: 120, borderRadius: 12, backgroundColor: COLORS.surface, marginBottom: 8 },
  cardTitle: { color: COLORS.textLight, fontSize: 12, fontWeight: "600" },
  cardMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  trackRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12 },
  trackRowActive: { backgroundColor: "rgba(255,255,255,0.08)" },
  trackRowMain: { flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 },
  trackIndex: { width: 28, textAlign: "center", color: COLORS.textMuted, fontSize: 12 },
  trackThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: COLORS.surface, marginRight: 12 },
  trackMeta: { flex: 1, minWidth: 0 },
  trackTitle: { color: COLORS.textLight, fontSize: 14, fontWeight: "500" },
  trackArtist: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  duration: { color: "#52525b", fontSize: 12 },
  iconHit: { padding: 10, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  coverFallback: { backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  emptyState: { alignItems: "center", paddingVertical: 28, paddingHorizontal: 16, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.1)", borderRadius: 16, backgroundColor: "#101012" },
  emptyTitle: { color: COLORS.textLight, fontSize: 14, fontWeight: "600" },
  emptyBody: { color: COLORS.textMuted, fontSize: 13, textAlign: "center", marginTop: 6, maxWidth: 280 },
  primaryPill: { marginTop: 14, backgroundColor: COLORS.teal, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, alignItems: "center" },
  primaryPillText: { color: COLORS.textDark, fontWeight: "700", fontSize: 13 },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  skeletonArt: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#24242c" },
  skeletonLine: { height: 10, borderRadius: 4, backgroundColor: "#24242c" },
  genreGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
  genreCard: { width: (SCREEN_WIDTH - 52) / 2, height: 96, borderRadius: 16, padding: 14, overflow: "hidden" },
  genreTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  genreThumb: { position: "absolute", width: 56, height: 56, borderRadius: 6, right: -8, bottom: -8, transform: [{ rotate: "25deg" }] },
  searchBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#16161a", borderRadius: 12, paddingHorizontal: 12, height: 48, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", marginTop: 16, gap: 10 },
  searchInput: { flex: 1, color: COLORS.textLight, fontSize: 15, height: "100%", padding: 0 },
  ghostText: { position: "absolute", left: 38, right: 36, fontSize: 15, height: 48, lineHeight: 48 },
  recentSearchRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  albumHeader: { alignItems: "center", gap: 6, marginBottom: 16 },
  albumHero: { width: 160, height: 160, borderRadius: 16, backgroundColor: COLORS.surface, marginBottom: 8 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  outlinePill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: "rgba(129,247,229,0.4)" },
  outlinePillText: { color: COLORS.teal, fontWeight: "700", fontSize: 13 },
  createPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.teal, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  createPillText: { color: COLORS.textDark, fontWeight: "700", fontSize: 12 },
  albumGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  albumGridItem: { width: (SCREEN_WIDTH - 52) / 2, marginBottom: 16 },
  albumGridArt: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: COLORS.surface, marginBottom: 8 },
  miniPlayer: { position: "absolute", left: 12, right: 12, bottom: 64, height: 72, borderRadius: 16, backgroundColor: "#111115", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, zIndex: 50 },
  miniArt: { width: 48, height: 48, borderRadius: 8, backgroundColor: COLORS.surface },
  busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", borderRadius: 8 },
  busyLabel: { color: "#fff", fontSize: 12, marginTop: 8 },
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, height: 64, backgroundColor: "#0a0a0d", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)", flexDirection: "row", justifyContent: "space-around", alignItems: "center", zIndex: 40 },
  tabItem: { alignItems: "center", justifyContent: "center", width: 80, height: "100%", gap: 2 },
  tabLabel: { color: COLORS.textMuted, fontSize: 11 },
  fullPlayer: { flex: 1, backgroundColor: COLORS.background, justifyContent: "space-between", paddingVertical: 8 },
  fullHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, height: 56 },
  fullHeaderActions: { flexDirection: "row", alignItems: "center" },
  nowPlayingLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  artworkWrap: { alignItems: "center", justifyContent: "center" },
  lyricsWrap: { flex: 1, width: "100%", paddingHorizontal: 24, minHeight: 180 },
  lyricsScroll: { flex: 1 },
  lyricsContent: { paddingVertical: 32, paddingBottom: 48 },
  lyricsEmpty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  lyricsEmptyText: { color: COLORS.textMuted, textAlign: "center", fontSize: 14, marginTop: 10 },
  lyricLine: { color: "rgba(255,255,255,0.34)", fontSize: 22, fontWeight: "700", lineHeight: 30, paddingVertical: 8 },
  lyricLineActive: { color: "#ffffff", fontSize: 24, lineHeight: 32 },
  lyricLinePast: { color: "rgba(255,255,255,0.22)" },
  lyricLinePlain: { fontSize: 16, fontWeight: "500", color: "rgba(255,255,255,0.78)", lineHeight: 24 },
  fullArt: { width: SCREEN_WIDTH * 0.72, height: SCREEN_WIDTH * 0.72, borderRadius: 16, backgroundColor: COLORS.surface },
  fullMeta: { flexDirection: "row", alignItems: "center", paddingHorizontal: 32 },
  fullTitle: { color: COLORS.textLight, fontSize: 22, fontWeight: "700" },
  fullArtist: { color: COLORS.teal, fontSize: 14, marginTop: 4, fontWeight: "500" },
  errorBanner: { marginHorizontal: 32, flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 10, borderRadius: 12, backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" },
  errorText: { color: "#fca5a5", fontSize: 12 },
  seekWrap: { paddingHorizontal: 32 },
  sliderHit: { width: "100%", paddingVertical: 12 },
  sliderHitFlex: { flex: 1, paddingVertical: 12 },
  sliderTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 2, position: "relative" },
  sliderFill: { height: "100%", backgroundColor: COLORS.teal, borderRadius: 2 },
  sliderThumb: { position: "absolute", width: 12, height: 12, borderRadius: 6, backgroundColor: "#fff", top: -4, marginLeft: -6 },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  timeText: { color: COLORS.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  controlsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 32 },
  volumeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 32, gap: 12, marginBottom: 16 },
  volumeTrack: { height: 3, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 2, position: "relative" },
  volumeFill: { height: "100%", backgroundColor: COLORS.cyan, borderRadius: 2 },
  volumeThumb: { position: "absolute", width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff", top: -3.5, marginLeft: -5 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "70%" },
  kicker: { color: COLORS.textMuted, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 360, backgroundColor: COLORS.surface, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  modalTitle: { color: COLORS.textLight, fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 12 },
  modalError: { color: "#f87171", fontSize: 12, textAlign: "center", marginBottom: 8 },
  inputLabel: { color: COLORS.lavender, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 10, marginBottom: 6 },
  modalInput: { backgroundColor: COLORS.surfaceLight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", marginBottom: 8 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 12 },
  modalGhost: { flex: 1, backgroundColor: COLORS.surfaceLight, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  modalCancel: { color: COLORS.textMuted, textAlign: "center", paddingVertical: 8 },
  deletePill: { flex: 1, backgroundColor: "#ef4444", borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  deletePillText: { color: "#fff", fontWeight: "700" },
  preset: { marginRight: 10, borderRadius: 8, borderWidth: 2, borderColor: "transparent", overflow: "hidden" },
  presetSelected: { borderColor: COLORS.teal },
  presetImage: { width: 48, height: 48 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  addThumb: { width: 36, height: 36, borderRadius: 6, backgroundColor: COLORS.surfaceLight },
});
