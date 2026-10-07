"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import Hls from "hls.js";
import { apiFetch, ensureSession, mediaUrl, safeImageUrl } from "@/lib/api";
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
    SpinnerIcon,
    RetryIcon,
    ExpandIcon,
    LyricsIcon,
} from "@/components/Icons";

interface LibraryTrack
{
    title: string;
    artist: string;
    thumbnail: string;
    query: string;
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

interface PlaybackPrefs
{
    volume: number;
    isLooping: boolean;
    isShuffled: boolean;
    isAutoplay: boolean;
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
    "/images/aetheris.webp",
    "/images/cyberpunk_essentials.webp",
    "/images/neo_flora.webp",
];

const GENRES = [
    { title: "Synthwave", className: "bg-gradient-synthwave", thumb: "/images/cyberpunk_essentials.webp" },
    { title: "Lo-Fi Beats", className: "bg-gradient-lofi", thumb: "/images/neo_flora.webp" },
    { title: "Techno & Club", className: "bg-gradient-techno", thumb: "/images/aetheris.webp" },
    { title: "Indie Rock", className: "bg-gradient-indie", thumb: "/images/aetheris.webp" },
    { title: "Hip-Hop", className: "bg-gradient-hiphop", thumb: "/images/cyberpunk_essentials.webp" },
    { title: "Chill Ambient", className: "bg-gradient-ambient", thumb: "/images/neo_flora.webp" },
];

const STORAGE = {
    recent: "recentTracks",
    liked: "likedTracks",
    albums: "createdAlbums",
    prefs: "playbackPrefs",
    session: "lastSession",
    legacyRecent: "recentSongs",
};

const SUGGESTION_DEBOUNCE_MS = 220;
const SUGGESTION_MIN_CHARS = 2;

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

function trackKey(track: Partial<LibraryTrack> & { query?: unknown; title?: unknown; artist?: unknown }): string
{
    const queryText = normalizeTrackText(track.query);
    const fallbackText = [normalizeTrackText(track.title), normalizeTrackText(track.artist)]
        .filter(Boolean)
        .join(" ")
        .trim();

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
    const query = normalizeTrackText(queryOverride)
        || normalizeTrackText(source.query)
        || `${title} ${artist}`.trim();

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

    return raw
        .map((item) => asTrack(item))
        .filter((item) => item.title || item.query);
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

function formatTime(seconds: number): string
{
    if (!seconds || isNaN(seconds) || !isFinite(seconds))
    {
        return "0:00";
    }

    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
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

function shuffleIndices(length: number, pinned = 0): number[]
{
    const rest = Array.from({ length }, (_, index) => index).filter((index) => index !== pinned);
    for (let i = rest.length - 1; i > 0; i--)
    {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return [pinned, ...rest];
}

function readJson<T>(key: string): T | null
{
    try
    {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : null;
    }
    catch
    {
        return null;
    }
}

function Cover({
    src,
    alt,
    width,
    height,
    className,
    priority = false,
}: {
    src?: string;
    alt: string;
    width: number;
    height: number;
    className?: string;
    priority?: boolean;
})
{
    const safe = safeImageUrl(src);
    if (!safe)
    {
        return (
            <div className={`${className || ""} bg-zinc-800 flex items-center justify-center text-zinc-500`}>
                <MusicIcon size={Math.min(width, height) * 0.4} />
            </div>
        );
    }

    if (safe.startsWith("/"))
    {
        return (
            <Image
                src={safe}
                alt={alt}
                width={width}
                height={height}
                className={className}
                priority={priority}
            />
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={safe}
            alt={alt}
            width={width}
            height={height}
            className={className}
            loading={priority ? "eager" : "lazy"}
        />
    );
}

function IconButton({
    label,
    onClick,
    disabled,
    active,
    children,
    className = "",
}: {
    label: string;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    active?: boolean;
    children: React.ReactNode;
    className?: string;
})
{
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex items-center justify-center min-w-11 min-h-11 rounded-full transition-colors disabled:opacity-35 disabled:pointer-events-none ${
                active ? "text-teal" : "text-gray-400 hover:text-white"
            } ${className}`}
        >
            {children}
        </button>
    );
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
        <div className="flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl border border-dashed border-white/10 bg-[#101012]">
            <div className="text-teal mb-3">{icon}</div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-sm text-gray-400 mt-1 max-w-sm">{body}</p>
            {actionLabel && onAction && (
                <button
                    type="button"
                    onClick={onAction}
                    className="mt-4 px-4 py-2 text-sm font-semibold rounded-full bg-teal text-black hover:opacity-90 transition-opacity"
                >
                    {actionLabel}
                </button>
            )}
        </div>
    );
}

function SkeletonRow()
{
    return (
        <div className="flex items-center gap-3 p-3">
            <div className="w-11 h-11 rounded-lg skeleton-shimmer" />
            <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 rounded skeleton-shimmer" />
                <div className="h-2.5 w-1/3 rounded skeleton-shimmer" />
            </div>
        </div>
    );
}

export default function Home()
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
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState(false);
    const [songQuery, setSongQuery] = useState("");
    const [songSuggestions, setSongSuggestions] = useState<Suggestion[]>([]);
    const [playList, setPlayList] = useState<LibraryTrack[]>([]);
    const [playIndex, setPlayIndex] = useState(0);
    const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);

    const audioRef = useRef<HTMLAudioElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suggestionRequestIdRef = useRef(0);
    const songSuggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recommendationsRef = useRef<Recommendation[]>([]);
    const playListRef = useRef<LibraryTrack[]>([]);
    const playIndexRef = useRef(0);
    const shuffleOrderRef = useRef<number[]>([]);
    const isShuffledRef = useRef(false);
    const isAutoplayRef = useRef(true);
    const pendingSeekRef = useRef<number | null>(null);
    const lastQueryRef = useRef("");
    const prefsReadyRef = useRef(false);
    const lyricsRequestIdRef = useRef(0);
    const lyricsPaneRef = useRef<HTMLDivElement>(null);
    const activeLyricRef = useRef<HTMLButtonElement | null>(null);
    const lyricsUserScrollRef = useRef(false);
    const lyricsScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const durationRef = useRef(0);

    recommendationsRef.current = recommendations;
    playListRef.current = playList;
    playIndexRef.current = playIndex;
    shuffleOrderRef.current = shuffleOrder;
    isShuffledRef.current = isShuffled;
    isAutoplayRef.current = isAutoplay;
    durationRef.current = duration;

    const likedKeys = new Set(likedTracks.map(trackKey));
    const isBusy = playStatus === "finding" || playStatus === "buffering";
    const isPlaying = playStatus === "playing";
    const seekPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
    const lyricIndex = lyrics ? activeLyricIndex(lyrics.lines, currentTime, lyrics.synced) : -1;

    const persistPrefs = useCallback((next: Partial<PlaybackPrefs>) =>
    {
        const prefs: PlaybackPrefs = {
            volume,
            isLooping,
            isShuffled,
            isAutoplay,
            ...next,
        };
        localStorage.setItem(STORAGE.prefs, JSON.stringify(prefs));
    }, [volume, isLooping, isShuffled, isAutoplay]);

    const persistSession = useCallback((song: SongInfo | null, position: number) =>
    {
        if (!song)
        {
            localStorage.removeItem(STORAGE.session);
            return;
        }
        localStorage.setItem(STORAGE.session, JSON.stringify({
            track: asTrack(song, lastQueryRef.current || trackKey(song)),
            position,
        }));
    }, []);

    const destroyHls = () =>
    {
        if (hlsRef.current)
        {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
    };

    const attachStream = (url: string, isHls: boolean) =>
    {
        const audio = audioRef.current;
        if (!audio)
        {
            return Promise.reject(new Error("Audio element missing"));
        }

        destroyHls();
        audio.volume = volume;

        if (isHls && Hls.isSupported())
        {
            const instance = new Hls({
                enableWorker: true,
                startLevel: 0,
                abrEwmaDefaultEstimate: 400000,
                maxBufferLength: 30,
                maxMaxBufferLength: 90,
                maxBufferSize: 8 * 1000 * 1000,
                backBufferLength: 10,
                xhrSetup: (xhr) =>
                {
                    xhr.withCredentials = true;
                },
            });
            hlsRef.current = instance;
            audio.crossOrigin = "use-credentials";
            instance.loadSource(url);
            instance.attachMedia(audio);
            return new Promise<void>((resolve, reject) =>
            {
                let started = false;
                instance.on(Hls.Events.MANIFEST_PARSED, () =>
                {
                    audio.play().then(() =>
                    {
                        started = true;
                        resolve();
                    }).catch(reject);
                });
                instance.on(Hls.Events.ERROR, (_event, data) =>
                {
                    if (!data.fatal)
                    {
                        return;
                    }
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR)
                    {
                        instance.startLoad();
                        return;
                    }
                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR)
                    {
                        instance.recoverMediaError();
                        return;
                    }
                    if (!started)
                    {
                        reject(data);
                    }
                });
            });
        }

        audio.crossOrigin = "use-credentials";
        audio.src = url;
        return audio.play().then(() => undefined);
    };

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

    useEffect(() =>
    {
        const storedRecent = readJson<unknown>(STORAGE.recent);
        const loadedRecent = coerceTrackList(storedRecent);
        if (loadedRecent.length > 0)
        {
            setRecentTracks(loadedRecent);
        }
        else
        {
            setRecentTracks(coerceTrackList(readJson<unknown>(STORAGE.legacyRecent)));
        }

        const storedLiked = readJson<unknown>(STORAGE.liked);
        setLikedTracks(coerceTrackList(storedLiked));

        const storedAlbums = readJson<Album[]>(STORAGE.albums);
        if (Array.isArray(storedAlbums))
        {
            setAlbums(storedAlbums.map((album, index) => ({
                id: album.id || `migrated-${index}`,
                title: normalizeTrackText(album.title),
                year: normalizeTrackText(album.year),
                thumbnail: safeImageUrl(album.thumbnail) || ALBUM_PRESETS[0],
                songs: coerceTrackList(album.songs),
            })));
        }

        const prefs = readJson<PlaybackPrefs>(STORAGE.prefs);
        if (prefs)
        {
            if (typeof prefs.volume === "number")
            {
                setVolume(Math.min(1, Math.max(0, prefs.volume)));
            }
            if (typeof prefs.isLooping === "boolean")
            {
                setIsLooping(prefs.isLooping);
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

        const session = readJson<{ track: LibraryTrack; position: number }>(STORAGE.session);
        if (session?.track)
        {
            const restored = asTrack(session.track);
            setCurrentSong(restored);
            lastQueryRef.current = restored.query;
            pendingSeekRef.current = session.position || 0;
            setCurrentTime(session.position || 0);
            setPlayStatus("paused");
        }

        prefsReadyRef.current = true;

        ensureSession()
            .then(() => fetchRecommendations())
            .catch((error) => console.error("Failed to start session", error));

        if ("serviceWorker" in navigator)
        {
            navigator.serviceWorker.register("/sw.js").catch(() => {});
        }

        const resume = () =>
        {
            audioRef.current?.play().catch(() => {});
        };
        window.addEventListener("online", resume);
        return () => window.removeEventListener("online", resume);
    }, []);

    useEffect(() =>
    {
        if (!prefsReadyRef.current)
        {
            return;
        }
        persistPrefs({});
    }, [volume, isLooping, isShuffled, isAutoplay, persistPrefs]);

    const addToHistory = (track: LibraryTrack) =>
    {
        setRecentTracks((prev) =>
        {
            const next = [track, ...prev.filter((item) => trackKey(item) !== trackKey(track))].slice(0, 20);
            localStorage.setItem(STORAGE.recent, JSON.stringify(next));
            return next;
        });
    };

    const removeRecentTrack = (track: LibraryTrack) =>
    {
        setRecentTracks((prev) =>
        {
            const next = prev.filter((item) => trackKey(item) !== trackKey(track));
            localStorage.setItem(STORAGE.recent, JSON.stringify(next));
            return next;
        });
    };

    const clearRecentTracks = () =>
    {
        setRecentTracks([]);
        localStorage.removeItem(STORAGE.recent);
        localStorage.removeItem(STORAGE.legacyRecent);
    };

    const saveAlbums = (next: Album[]) =>
    {
        setAlbums(next);
        localStorage.setItem(STORAGE.albums, JSON.stringify(next));
    };

    const setQueueFrom = (seed: LibraryTrack, extras: LibraryTrack[]) =>
    {
        const rest = extras.filter((item) => trackKey(item) !== trackKey(seed));
        const queue = [seed, ...rest];
        setPlayList(queue);
        setPlayIndex(0);
        const order = isShuffledRef.current ? shuffleIndices(queue.length, 0) : queue.map((_, index) => index);
        setShuffleOrder(order);
    };

    const upcomingTracks = (): LibraryTrack[] =>
    {
        if (playList.length === 0)
        {
            return recommendations.filter((item) => trackKey(item) !== lastQueryRef.current).slice(0, 8);
        }
        const order = (isShuffled ? shuffleOrder : playList.map((_, index) => index));
        const position = order.indexOf(playIndex);
        return order.slice(position + 1).map((index) => playList[index]).filter(Boolean).slice(0, 8);
    };

    const canSkipNext = upcomingTracks().length > 0 || recommendations.some((item) => trackKey(item) !== lastQueryRef.current);
    const canSkipPrev = currentTime > 3 || playIndex > 0 || (isShuffled && shuffleOrder.indexOf(playIndex) > 0);

    const prefetchNextBurst = async (next: LibraryTrack) =>
    {
        try
        {
            const playRes = await apiFetch(`/play/${encodeURIComponent(next.query)}`);
            if (!playRes.ok)
            {
                return;
            }
            const playData = await playRes.json();
            const masterUrl = mediaUrl(playData.url);
            if (!masterUrl || playData.type !== "hls")
            {
                return;
            }
            const masterRes = await fetch(masterUrl, { credentials: "include" });
            if (!masterRes.ok)
            {
                return;
            }
            const masterText = await masterRes.text();
            const playlistRel = masterText.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
            if (!playlistRel)
            {
                return;
            }
            const playlistUrl = new URL(playlistRel, masterUrl).toString();
            const playlistRes = await fetch(playlistUrl, { credentials: "include" });
            if (!playlistRes.ok)
            {
                return;
            }
            const playlistText = await playlistRes.text();
            const segments = playlistText
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#"))
                .slice(0, 3);
            for (const segment of segments)
            {
                await fetch(new URL(segment, playlistUrl).toString(), { credentials: "include" });
            }
        }
        catch (error)
        {
            console.log("Next-track prefetch skipped", error);
        }
    };

    const playSong = async (
        songInput: string | LibraryTrack | Recommendation,
        list?: LibraryTrack[],
        options?: { replaceQueue?: boolean; index?: number }
    ) =>
    {
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
        setSuggestions([]);
        setRecommendations((prev) => prev.filter((item) => trackKey(item) !== track.query));
        addToHistory(track);

        if (options?.replaceQueue !== false)
        {
            const extras = list && list.length > 0
                ? list
                : recommendationsRef.current;
            setQueueFrom(track, extras.map((item) => asTrack(item)));
        }
        else if (options?.index != null)
        {
            setPlayIndex(options.index);
        }

        let songUrl = "";
        let isHls = false;

        try
        {
            const playRes = await apiFetch(`/play/${encodeURIComponent(track.query)}`);
            if (playRes.ok)
            {
                const playData = await playRes.json();
                songUrl = mediaUrl(playData.url);
                isHls = playData.type === "hls";
            }
            else
            {
                console.log("Stream resolve failed", playRes.status, await playRes.text().catch(() => ""));
            }
        }
        catch (error)
        {
            console.log("Stream resolve failed", error);
        }

        const applyMetadata = (info: SongInfo | null) =>
        {
            if ("mediaSession" in navigator)
            {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: info?.title || track.title,
                    artist: info?.artist || "ZIZO Music",
                    artwork: info?.thumbnail ? [{ src: info.thumbnail, sizes: "512x512", type: "image/jpeg" }] : [],
                });
            }
        };

        if (!songUrl)
        {
            setPlayStatus("error");
            return;
        }

        try
        {
            await attachStream(songUrl, isHls);
            if (pendingSeekRef.current && audioRef.current)
            {
                audioRef.current.currentTime = pendingSeekRef.current;
                pendingSeekRef.current = null;
            }
            setPlayStatus("playing");
            applyMetadata(track);
            const next = upcomingTracks()[0] || recommendationsRef.current.find((item) => item.query !== track.query);
            if (next)
            {
                prefetchNextBurst(next);
            }
        }
        catch (error)
        {
            console.error(error);
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
                applyMetadata(resolved);
            });
        }
    };

    const skipNext = () =>
    {
        const upcoming = upcomingTracks();
        if (upcoming[0])
        {
            const next = upcoming[0];
            const nextIndex = playListRef.current.findIndex((item) => trackKey(item) === trackKey(next));
            if (nextIndex >= 0)
            {
                setPlayIndex(nextIndex);
            }
            playSong(next, playListRef.current, { replaceQueue: false, index: nextIndex >= 0 ? nextIndex : undefined });
            return;
        }

        const fallback = recommendationsRef.current.find((item) => item.query !== lastQueryRef.current);
        if (fallback)
        {
            playSong(fallback, recommendationsRef.current);
        }
    };

    const skipPrevious = () =>
    {
        if (audioRef.current && audioRef.current.currentTime > 3)
        {
            audioRef.current.currentTime = 0;
            setCurrentTime(0);
            return;
        }

        const order = isShuffledRef.current
            ? shuffleOrderRef.current
            : playListRef.current.map((_, index) => index);
        const position = order.indexOf(playIndexRef.current);
        const prevIndex = order[position - 1];
        if (prevIndex == null)
        {
            if (audioRef.current)
            {
                audioRef.current.currentTime = 0;
                setCurrentTime(0);
            }
            return;
        }
        playSong(playListRef.current[prevIndex], playListRef.current, { replaceQueue: false, index: prevIndex });
    };

    const toggleShuffle = () =>
    {
        const next = !isShuffled;
        setIsShuffled(next);
        if (playList.length === 0)
        {
            return;
        }
        setShuffleOrder(next ? shuffleIndices(playList.length, playIndex) : playList.map((_, index) => index));
    };

    const handleSongEnd = () =>
    {
        setPlayStatus("paused");
        if (isAutoplayRef.current)
        {
            skipNext();
        }
    };

    const handleTimeUpdate = () =>
    {
        if (audioRef.current)
        {
            setCurrentTime(audioRef.current.currentTime);
            setDuration(audioRef.current.duration || 0);
            persistSession(currentSong, audioRef.current.currentTime);
        }
    };

    const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) =>
    {
        const time = parseFloat(event.target.value);
        if (audioRef.current)
        {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const seekToLyric = (time: number) =>
    {
        if (!audioRef.current || !Number.isFinite(time))
        {
            return;
        }
        audioRef.current.currentTime = time;
        setCurrentTime(time);
        lyricsUserScrollRef.current = false;
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

    const openLyrics = () =>
    {
        setShowLyrics(true);
        setShowFullPlayer(true);
    };

    const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    {
        const nextVolume = parseFloat(event.target.value);
        setVolume(nextVolume);
        if (audioRef.current)
        {
            audioRef.current.volume = nextVolume;
        }
    };

    const togglePlayback = () =>
    {
        const audio = audioRef.current;
        if (!audio)
        {
            return;
        }
        if (!audio.src && !hlsRef.current && currentSong)
        {
            playSong(asTrack(currentSong, lastQueryRef.current));
            return;
        }
        if (isPlaying || isBusy)
        {
            audio.pause();
            setPlayStatus("paused");
            return;
        }
        audio.play().then(() => setPlayStatus("playing")).catch(() => setPlayStatus("error"));
    };

    const toggleLike = (song: SongInfo | LibraryTrack) =>
    {
        const track = asTrack(song, "query" in song ? song.query : lastQueryRef.current);
        const key = trackKey(track);
        const exists = likedTracks.some((item) => trackKey(item) === key);
        const next = exists
            ? likedTracks.filter((item) => trackKey(item) !== key)
            : [track, ...likedTracks];
        setLikedTracks(next);
        localStorage.setItem(STORAGE.liked, JSON.stringify(next));
    };

    const handleCreateAlbum = () =>
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
        const updated = {
            ...activeAlbum,
            songs: activeAlbum.songs.filter((item) => trackKey(item) !== trackKey(track)),
        };
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
            setSuggestions((data.suggestions || []).map((item: Suggestion) => ({
                ...item,
                title: normalizeTrackText(item.title),
                artist: normalizeTrackText(item.artist),
            })));
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
        setQuery(normalizeTrackText(text));
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

    const getGhostText = () =>
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
    };

    const ghostText = getGhostText();
    const greeting = greetingForHour(new Date().getHours());
    const displaySong = currentSong ? asTrack(currentSong, lastQueryRef.current) : null;
    const continueTrack = displaySong || (recentTracks[0] ? asTrack(recentTracks[0]) : null);
    const currentKey = displaySong ? trackKey(displaySong) : "";
    const currentLiked = displaySong ? likedKeys.has(currentKey) || likedKeys.has(displaySong.title) : false;
    const queueItems = upcomingTracks();

    const updateMediaSessionPosition = () =>
    {
        if ("mediaSession" in navigator && audioRef.current && !isNaN(audioRef.current.duration))
        {
            try
            {
                navigator.mediaSession.setPositionState({
                    duration: audioRef.current.duration,
                    playbackRate: audioRef.current.playbackRate,
                    position: audioRef.current.currentTime,
                });
            }
            catch
            {
                // Ignore unsupported browsers.
            }
        }
    };

    useEffect(() =>
    {
        if (!("mediaSession" in navigator))
        {
            return;
        }
        navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play());
        navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
        navigator.mediaSession.setActionHandler("previoustrack", () => skipPrevious());
        navigator.mediaSession.setActionHandler("nexttrack", () => skipNext());
        navigator.mediaSession.setActionHandler("seekto", (details) =>
        {
            if (details.seekTime != null && audioRef.current)
            {
                audioRef.current.currentTime = details.seekTime;
            }
        });
    });

    useEffect(() =>
    {
        const onKey = (event: KeyboardEvent) =>
        {
            const target = event.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
            {
                return;
            }
            if (event.code === "Space" && currentSong)
            {
                event.preventDefault();
                togglePlayback();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    useEffect(() =>
    {
        return () =>
        {
            if (suggestionTimerRef.current)
            {
                clearTimeout(suggestionTimerRef.current);
            }
            if (songSuggestionTimerRef.current)
            {
                clearTimeout(songSuggestionTimerRef.current);
            }
            if (lyricsScrollTimerRef.current)
            {
                clearTimeout(lyricsScrollTimerRef.current);
            }
            destroyHls();
        };
    }, []);

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
            : durationRef.current;

        setLyrics(null);
        setLyricsLoading(true);
        lyricsUserScrollRef.current = false;

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

        const line = activeLyricRef.current;
        const pane = lyricsPaneRef.current;
        if (!line || !pane)
        {
            return;
        }

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const target = line.offsetTop - pane.clientHeight * 0.38;
        pane.scrollTo({
            top: Math.max(0, target),
            behavior: reducedMotion ? "auto" : "smooth",
        });
    }, [lyricIndex, showLyrics, showFullPlayer]);

    const openAlbum = (album: Album) =>
    {
        setActiveAlbum(album);
        setLibraryView("album");
        setActiveTab("library");
    };

    const goHome = () =>
    {
        setActiveTab("home");
        setLibraryView("root");
        setActiveAlbum(null);
        clearSuggestions();
    };

    const renderTrackRow = (track: LibraryTrack | null | undefined, options?: {
        index?: number;
        onRemove?: () => void;
        list?: LibraryTrack[];
        showDuration?: string;
    }) =>
    {
        if (!track || typeof track !== "object" || Array.isArray(track))
        {
            return null;
        }

        const safeTrack: LibraryTrack = {
            title: normalizeTrackText(track.title),
            artist: normalizeTrackText(track.artist),
            thumbnail: safeImageUrl(track.thumbnail) || "",
            query: normalizeTrackText(track.query) || normalizeTrackText(track.title),
        };

        const playingHere = currentKey && trackKey(safeTrack) === currentKey;
        return (
            <div
                key={`${trackKey(safeTrack)}-${options?.index ?? 0}`}
                className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors group ${
                    playingHere ? "bg-white/10" : "hover:bg-white/5"
                }`}
            >
                <button
                    type="button"
                    onClick={() => playSong(safeTrack, options?.list)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                    {options?.index != null && (
                        <span className="w-7 text-center text-xs tabular-nums text-gray-500">
                            {String(options.index + 1).padStart(2, "0")}
                        </span>
                    )}
                    <Cover
                        src={safeTrack.thumbnail}
                        alt=""
                        width={44}
                        height={44}
                        className="w-11 h-11 object-cover rounded-lg bg-zinc-800 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${playingHere ? "text-teal" : "text-white"}`}>
                            {safeTrack.title || "Untitled track"}
                        </p>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{safeTrack.artist || "Unknown artist"}</p>
                    </div>
                    {options?.showDuration && (
                        <span className="text-xs text-gray-500 tabular-nums">{options.showDuration}</span>
                    )}
                    <span className="opacity-0 group-hover:opacity-100 text-teal">
                        <PlayIcon size={16} />
                    </span>
                </button>
                {options?.onRemove && (
                    <IconButton label="Remove" onClick={options.onRemove} className="min-w-9 min-h-9">
                        <TrashIcon size={16} />
                    </IconButton>
                )}
            </div>
        );
    };

    const playerStatusLabel = playStatus === "finding"
        ? "Finding track"
        : playStatus === "buffering"
            ? "Buffering"
            : playStatus === "error"
                ? "Couldn't play this track"
                : "";

    return (
        <div className="flex h-screen w-screen bg-[#070708] text-white overflow-hidden">
            <audio
                ref={audioRef}
                loop={isLooping}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleTimeUpdate}
                onWaiting={() => setPlayStatus("buffering")}
                onPlaying={() =>
                {
                    setPlayStatus("playing");
                    if ("mediaSession" in navigator)
                    {
                        navigator.mediaSession.playbackState = "playing";
                    }
                    updateMediaSessionPosition();
                }}
                onPlay={() =>
                {
                    setPlayStatus("playing");
                    if ("mediaSession" in navigator)
                    {
                        navigator.mediaSession.playbackState = "playing";
                    }
                }}
                onPause={() =>
                {
                    setPlayStatus("paused");
                    if ("mediaSession" in navigator)
                    {
                        navigator.mediaSession.playbackState = "paused";
                    }
                    updateMediaSessionPosition();
                }}
                onEnded={handleSongEnd}
                onSeeked={updateMediaSessionPosition}
                onRateChange={updateMediaSessionPosition}
                onError={() => setPlayStatus("error")}
            />

            <aside className="hidden md:flex flex-col w-64 bg-[#0a0a0d] border-r border-white/5 p-6 shrink-0">
                <div className="flex items-center gap-3 mb-10">
                    <Cover src="/logo.webp" alt="ZIZO Music" width={32} height={32} className="w-8 h-8 rounded" priority />
                    <span className="text-lg font-semibold tracking-tight">ZIZO Music</span>
                </div>
                <nav className="flex flex-col gap-1 flex-1">
                    {[
                        { id: "home" as const, label: "Home", icon: <HomeIcon size={18} />, action: goHome },
                        { id: "search" as const, label: "Search", icon: <SearchIcon size={18} />, action: () => { setActiveTab("search"); setActiveAlbum(null); } },
                        { id: "library" as const, label: "Library", icon: <LibraryIcon size={18} />, action: () => { setActiveTab("library"); setLibraryView("root"); setActiveAlbum(null); clearSuggestions(); } },
                    ].map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={item.action}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                                activeTab === item.id ? "bg-white/10 text-teal" : "text-gray-400 hover:text-white hover:bg-white/5"
                            }`}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </nav>
                <Link href="/legal" className="text-xs text-gray-500 hover:text-gray-300 pt-4 border-t border-white/5">
                    Terms & Privacy
                </Link>
            </aside>

            <main className={`flex-1 flex flex-col min-w-0 overflow-y-auto ${currentSong ? "pb-[148px] md:pb-24" : "pb-20 md:pb-6"}`}>
                <div className="flex-1">
                    {activeTab === "home" && (
                        <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-10">
                            <div className="flex items-center gap-3 md:hidden">
                                <Cover src="/logo.webp" alt="ZIZO Music" width={28} height={28} className="w-7 h-7 rounded" priority />
                                <span className="text-base font-semibold">ZIZO Music</span>
                            </div>
                            <div>
                                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{greeting}</h1>
                                <p className="text-sm text-gray-400 mt-1">Pick up where you left off, or find something new.</p>
                            </div>

                            {continueTrack && (
                                <section>
                                    <h2 className="text-lg font-semibold mb-3">Continue listening</h2>
                                    <button
                                        type="button"
                                        onClick={() => playSong(continueTrack, recentTracks)}
                                        className="w-full flex items-center gap-4 p-3 rounded-2xl bg-[#101012] border border-white/5 hover:bg-white/5 transition-colors text-left"
                                    >
                                        <Cover
                                            src={continueTrack.thumbnail}
                                            alt=""
                                            width={72}
                                            height={72}
                                            className="w-16 h-16 md:w-[72px] md:h-[72px] object-cover rounded-xl bg-zinc-800"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-base font-semibold truncate">{continueTrack.title}</p>
                                            <p className="text-sm text-gray-400 truncate mt-0.5">
                                                {continueTrack.artist || "Unknown artist"}
                                            </p>
                                        </div>
                                        <span className="w-11 h-11 rounded-full bg-teal text-black flex items-center justify-center shrink-0">
                                            <PlayIcon size={18} />
                                        </span>
                                    </button>
                                </section>
                            )}

                            {recentTracks.length > 0 && (
                                <section>
                                    <div className="flex items-center justify-between mb-3">
                                        <h2 className="text-lg font-semibold">Recently played</h2>
                                        <button
                                            type="button"
                                            onClick={() => { setActiveTab("library"); setLibraryView("history"); }}
                                            className="text-sm text-gray-400 hover:text-white"
                                        >
                                            See all
                                        </button>
                                    </div>
                                    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                                        {recentTracks.slice(0, 10).map((track) => (
                                            <button
                                                key={trackKey(track)}
                                                type="button"
                                                onClick={() => playSong(track, recentTracks)}
                                                className="w-[120px] shrink-0 text-left"
                                            >
                                                <Cover
                                                    src={track.thumbnail}
                                                    alt=""
                                                    width={120}
                                                    height={120}
                                                    className="w-full aspect-square object-cover rounded-xl bg-zinc-800 mb-2"
                                                />
                                                <p className="text-xs font-medium truncate">{asTrack(track).title}</p>
                                                <p className="text-[11px] text-gray-500 truncate">{asTrack(track).artist}</p>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section>
                                <h2 className="text-lg font-semibold mb-3">Recommended for you</h2>
                                {recsLoading && (
                                    <div className="flex flex-col">
                                        <SkeletonRow />
                                        <SkeletonRow />
                                        <SkeletonRow />
                                    </div>
                                )}
                                {!recsLoading && recsError && (
                                    <EmptyState
                                        icon={<RetryIcon size={28} />}
                                        title="Couldn't load recommendations"
                                        body="Check your connection and try again."
                                        actionLabel="Retry"
                                        onAction={fetchRecommendations}
                                    />
                                )}
                                {!recsLoading && !recsError && recommendations.length === 0 && (
                                    <EmptyState
                                        icon={<SearchIcon size={28} />}
                                        title="Nothing queued yet"
                                        body="Search for a song and we'll start building recommendations around what you play."
                                        actionLabel="Search"
                                        onAction={() => setActiveTab("search")}
                                    />
                                )}
                                {!recsLoading && !recsError && recommendations.length > 0 && (
                                    <div className="flex flex-col">
                                        {recommendations.slice(0, 8).map((track, index) =>
                                            renderTrackRow(track, { index, list: recommendations })
                                        )}
                                    </div>
                                )}
                            </section>

                            {albums.length > 0 && (
                                <section>
                                    <div className="flex items-center justify-between mb-3">
                                        <h2 className="text-lg font-semibold">Your albums</h2>
                                        <button
                                            type="button"
                                            onClick={() => { setActiveTab("library"); setLibraryView("root"); }}
                                            className="text-sm text-gray-400 hover:text-white"
                                        >
                                            See all
                                        </button>
                                    </div>
                                    <div className="flex gap-3 overflow-x-auto no-scrollbar">
                                        {albums.map((album) => (
                                            <button
                                                key={album.id}
                                                type="button"
                                                onClick={() => openAlbum(album)}
                                                className="w-[132px] shrink-0 text-left"
                                            >
                                                <Cover
                                                    src={album.thumbnail}
                                                    alt=""
                                                    width={132}
                                                    height={132}
                                                    className="w-full aspect-square object-cover rounded-xl bg-zinc-800 mb-2"
                                                />
                                                <p className="text-xs font-medium truncate">{album.title}</p>
                                                <p className="text-[11px] text-gray-500">{album.year}</p>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section>
                                <h2 className="text-lg font-semibold mb-3">Browse genres</h2>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {GENRES.map((genre) => (
                                        <button
                                            key={genre.title}
                                            type="button"
                                            onClick={() => selectGenre(genre.title)}
                                            className={`h-24 rounded-2xl p-4 relative overflow-hidden text-left ${genre.className}`}
                                        >
                                            <span className="text-sm font-bold text-white relative z-10">{genre.title}</span>
                                            <div className="absolute -bottom-3 -right-3 w-14 h-14 rotate-[25deg] shadow-lg">
                                                <Cover src={genre.thumb} alt="" width={56} height={56} className="w-full h-full object-cover rounded-md" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === "search" && (
                        <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-6">
                            <h1 className="text-3xl md:text-4xl font-bold">Search</h1>
                            <div className="relative w-full max-w-xl">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                    <SearchIcon size={16} />
                                </span>
                                {ghostText && (
                                    <div className="absolute inset-0 pl-11 pr-10 py-3 text-sm text-white/30 pointer-events-none truncate">
                                        <span className="text-transparent">{query}</span>
                                        <span>{ghostText.slice(query.length)}</span>
                                    </div>
                                )}
                                <input
                                    type="search"
                                    value={query}
                                    onChange={(event) => handleQueryChange(event.target.value)}
                                    onKeyDown={(event) =>
                                    {
                                        if (event.key === "ArrowDown" && suggestions.length > 0)
                                        {
                                            event.preventDefault();
                                            setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
                                        }
                                        else if (event.key === "ArrowUp" && suggestions.length > 0)
                                        {
                                            event.preventDefault();
                                            setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                                        }
                                        else if (event.key === "Enter")
                                        {
                                            event.preventDefault();
                                            onSearchSubmit();
                                        }
                                        else if (event.key === "Tab" && ghostText)
                                        {
                                            event.preventDefault();
                                            handleQueryChange(ghostText);
                                        }
                                    }}
                                    placeholder="Songs or artists"
                                    aria-label="Search songs or artists"
                                    aria-autocomplete="list"
                                    className="w-full bg-[#16161a] border border-white/5 rounded-xl pl-11 pr-10 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-teal/40 relative"
                                />
                                {query && (
                                    <button
                                        type="button"
                                        aria-label="Clear search"
                                        onClick={() => { setQuery(""); clearSuggestions(); }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
                                    >
                                        <CloseIcon size={14} />
                                    </button>
                                )}
                            </div>

                            {searchLoading && (
                                <div>
                                    <SkeletonRow />
                                    <SkeletonRow />
                                    <SkeletonRow />
                                </div>
                            )}

                            {!searchLoading && searchError && (
                                <EmptyState
                                    icon={<RetryIcon size={28} />}
                                    title="Search didn't go through"
                                    body="We couldn't reach results for that query."
                                    actionLabel="Retry"
                                    onAction={() => fetchSuggestions(query.trim())}
                                />
                            )}

                            {!searchLoading && !searchError && query.trim().length >= SUGGESTION_MIN_CHARS && suggestions.length === 0 && (
                                <EmptyState
                                    icon={<SearchIcon size={28} />}
                                    title={`No songs match “${query.trim()}”`}
                                    body="Try a different spelling, or search by artist name."
                                />
                            )}

                            {!searchLoading && suggestions.length > 0 && (
                                <div role="listbox" className="flex flex-col bg-[#101012] border border-white/5 rounded-2xl overflow-hidden">
                                    {suggestions.map((suggestion, index) => (
                                        <button
                                            key={suggestion.id}
                                            type="button"
                                            role="option"
                                            aria-selected={index === highlightedIndex}
                                            onClick={() => playSuggestion(suggestion)}
                                            className={`flex items-center gap-3 p-4 text-left transition-colors ${
                                                index === highlightedIndex ? "bg-white/10" : "hover:bg-white/5"
                                            }`}
                                        >
                                            <Cover
                                                src={suggestion.thumbnail}
                                                alt=""
                                                width={44}
                                                height={44}
                                                className="w-11 h-11 object-cover rounded-lg bg-zinc-800"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate text-white">{normalizeTrackText(suggestion.title)}</p>
                                                <p className="text-xs text-gray-400 truncate">{normalizeTrackText(suggestion.artist)}</p>
                                            </div>
                                            {suggestion.duration && (
                                                <span className="text-xs text-gray-500 tabular-nums">{suggestion.duration}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {!searchLoading && query.trim().length < SUGGESTION_MIN_CHARS && (
                                <div className="flex flex-col gap-8">
                                    {recentTracks.length > 0 && (
                                        <section>
                                            <div className="flex items-center justify-between mb-3">
                                                <h2 className="text-lg font-semibold">Recent searches</h2>
                                                <button type="button" onClick={clearRecentTracks} className="text-sm text-teal">
                                                    Clear all
                                                </button>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                {recentTracks.slice(0, 8).map((track) => (
                                                    <div key={trackKey(track)} className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => { setQuery(track.query); handleQueryChange(track.query); }}
                                                            className="flex-1 flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-left min-w-0"
                                                        >
                                                            <ClockIcon size={16} className="text-gray-500 shrink-0" />
                                                            <span className="text-sm truncate">{asTrack(track).title}{asTrack(track).artist ? ` · ${asTrack(track).artist}` : ""}</span>
                                                        </button>
                                                        <IconButton label="Remove from history" onClick={() => removeRecentTrack(track)} className="min-w-9 min-h-9">
                                                            <CloseIcon size={14} />
                                                        </IconButton>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    )}
                                    <section>
                                        <h2 className="text-lg font-semibold mb-3">Browse all genres</h2>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                            {GENRES.map((genre) => (
                                                <button
                                                    key={genre.title}
                                                    type="button"
                                                    onClick={() => selectGenre(genre.title)}
                                                    className={`h-24 rounded-2xl p-4 relative overflow-hidden text-left ${genre.className}`}
                                                >
                                                    <span className="text-sm font-bold text-white relative z-10">{genre.title}</span>
                                                    <div className="absolute -bottom-3 -right-3 w-14 h-14 rotate-[25deg] shadow-lg">
                                                        <Cover src={genre.thumb} alt="" width={56} height={56} className="w-full h-full object-cover rounded-md" />
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </section>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "library" && libraryView === "album" && activeAlbum && (
                        <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-6">
                            <button
                                type="button"
                                onClick={() => { setLibraryView("root"); setActiveAlbum(null); }}
                                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10"
                                aria-label="Back to library"
                            >
                                <ChevronLeftIcon size={18} />
                            </button>
                            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5">
                                <Cover
                                    src={activeAlbum.thumbnail}
                                    alt=""
                                    width={180}
                                    height={180}
                                    className="w-40 h-40 object-cover rounded-2xl bg-zinc-800"
                                />
                                <div className="text-center sm:text-left min-w-0">
                                    <h1 className="text-3xl font-bold truncate">{activeAlbum.title}</h1>
                                    <p className="text-sm text-gray-400 mt-1">Album · {activeAlbum.year}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {activeAlbum.songs.length} {activeAlbum.songs.length === 1 ? "track" : "tracks"}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    disabled={activeAlbum.songs.length === 0}
                                    onClick={() => playSong(activeAlbum.songs[0], activeAlbum.songs)}
                                    className="w-12 h-12 rounded-full bg-teal text-black flex items-center justify-center disabled:opacity-40"
                                    aria-label="Play album"
                                >
                                    <PlayIcon size={20} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setSongQuery(""); setSongSuggestions([]); setModalError(""); setShowAddSongModal(true); }}
                                    className="px-4 py-2 rounded-full border border-teal/40 text-teal text-sm font-semibold"
                                >
                                    Add songs
                                </button>
                                <IconButton label="Delete album" onClick={() => setAlbumToDelete(activeAlbum)}>
                                    <TrashIcon size={18} />
                                </IconButton>
                            </div>
                            {activeAlbum.songs.length === 0 ? (
                                <EmptyState
                                    icon={<MusicIcon size={28} />}
                                    title="This album is empty"
                                    body="Add songs from search so you can play them in order."
                                    actionLabel="Add songs"
                                    onAction={() => setShowAddSongModal(true)}
                                />
                            ) : (
                                <div className="flex flex-col">
                                    {activeAlbum.songs.map((track, index) =>
                                        renderTrackRow(track, {
                                            index,
                                            list: activeAlbum.songs,
                                            onRemove: () => handleRemoveSongFromAlbum(track),
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "library" && libraryView === "liked" && (
                        <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-6">
                            <button type="button" onClick={() => setLibraryView("root")} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center" aria-label="Back to library">
                                <ChevronLeftIcon size={18} />
                            </button>
                            <h1 className="text-3xl font-bold">Liked songs</h1>
                            {likedTracks.length === 0 ? (
                                <EmptyState
                                    icon={<HeartIcon size={28} />}
                                    title="No liked songs yet"
                                    body="Tap the heart on a track while it's playing to save it here."
                                />
                            ) : (
                                <div className="flex flex-col">
                                    <button
                                        type="button"
                                        onClick={() => playSong(likedTracks[0], likedTracks)}
                                        className="w-12 h-12 rounded-full bg-teal text-black flex items-center justify-center mb-4"
                                        aria-label="Play liked songs"
                                    >
                                        <PlayIcon size={20} />
                                    </button>
                                    {likedTracks.map((track, index) => renderTrackRow(track, { index, list: likedTracks }))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "library" && libraryView === "history" && (
                        <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-6">
                            <button type="button" onClick={() => setLibraryView("root")} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center" aria-label="Back to library">
                                <ChevronLeftIcon size={18} />
                            </button>
                            <div className="flex items-center justify-between">
                                <h1 className="text-3xl font-bold">Recently played</h1>
                                {recentTracks.length > 0 && (
                                    <button type="button" onClick={clearRecentTracks} className="text-sm text-teal">Clear all</button>
                                )}
                            </div>
                            {recentTracks.length === 0 ? (
                                <EmptyState
                                    icon={<ClockIcon size={28} />}
                                    title="No listening history"
                                    body="Songs you play will show up here."
                                />
                            ) : (
                                <div className="flex flex-col">
                                    {recentTracks.map((track, index) =>
                                        renderTrackRow(track, { index, list: recentTracks, onRemove: () => removeRecentTrack(track) })
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "library" && libraryView === "root" && (
                        <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-10">
                            <h1 className="text-3xl md:text-4xl font-bold">Your library</h1>

                            <section>
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-lg font-semibold">Liked songs</h2>
                                    {likedTracks.length > 0 && (
                                        <button type="button" onClick={() => setLibraryView("liked")} className="text-sm text-gray-400 hover:text-white">
                                            See all
                                        </button>
                                    )}
                                </div>
                                {likedTracks.length === 0 ? (
                                    <p className="text-sm text-gray-400">Hearts you tap while listening are saved here.</p>
                                ) : (
                                    <div className="flex flex-col">
                                        {likedTracks.slice(0, 5).map((track, index) => renderTrackRow(track, { index, list: likedTracks }))}
                                    </div>
                                )}
                            </section>

                            <section>
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-lg font-semibold">Albums</h2>
                                    <button
                                        type="button"
                                        onClick={() =>
                                        {
                                            setNewAlbumTitle("");
                                            setNewAlbumYear("");
                                            setNewAlbumCover(ALBUM_PRESETS[0]);
                                            setModalError("");
                                            setShowCreateAlbumModal(true);
                                        }}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-full bg-teal text-black"
                                    >
                                        <PlusIcon size={14} /> Create
                                    </button>
                                </div>
                                {albums.length === 0 ? (
                                    <EmptyState
                                        icon={<DiscIcon size={28} />}
                                        title="No albums yet"
                                        body="Create an album and add songs you want to keep together."
                                        actionLabel="Create album"
                                        onAction={() => setShowCreateAlbumModal(true)}
                                    />
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                        {albums.map((album) => (
                                            <button
                                                key={album.id}
                                                type="button"
                                                onClick={() => openAlbum(album)}
                                                className="text-left"
                                            >
                                                <Cover
                                                    src={album.thumbnail}
                                                    alt=""
                                                    width={180}
                                                    height={180}
                                                    className="w-full aspect-square object-cover rounded-xl bg-zinc-800 mb-2"
                                                />
                                                <p className="text-sm font-medium truncate">{album.title}</p>
                                                <p className="text-xs text-gray-500">{album.songs.length} tracks · {album.year}</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section>
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-lg font-semibold">Recently played</h2>
                                    {recentTracks.length > 0 && (
                                        <button type="button" onClick={() => setLibraryView("history")} className="text-sm text-gray-400 hover:text-white">
                                            See all
                                        </button>
                                    )}
                                </div>
                                {recentTracks.length === 0 ? (
                                    <p className="text-sm text-gray-400">Your last plays will land here.</p>
                                ) : (
                                    <div className="flex flex-col">
                                        {recentTracks.slice(0, 5).map((track, index) => renderTrackRow(track, { index, list: recentTracks }))}
                                    </div>
                                )}
                            </section>
                        </div>
                    )}
                </div>
            </main>

            {currentSong && !showFullPlayer && (
                <>
                    <div className="md:hidden fixed left-3 right-3 bottom-16 h-[72px] z-30 rounded-2xl bg-[#111115] border border-white/10 flex items-center px-3 gap-3 shadow-lg shadow-black/40">
                        <button type="button" onClick={() => setShowFullPlayer(true)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                            <div className="relative">
                                <Cover src={currentSong.thumbnail} alt="" width={48} height={48} className="w-12 h-12 object-cover rounded-lg bg-zinc-800" />
                                {isBusy && (
                                    <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                                        <SpinnerIcon size={16} />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{displaySong?.title}</p>
                                <p className="text-xs text-gray-400 truncate">
                                    {playStatus === "error" ? "Could not play this track" : displaySong?.artist || playerStatusLabel}
                                </p>
                            </div>
                        </button>
                        {playStatus === "error" ? (
                            <IconButton label="Retry" onClick={() => playSong(asTrack(currentSong, lastQueryRef.current))}>
                                <RetryIcon size={18} />
                            </IconButton>
                        ) : (
                            <IconButton label={isPlaying ? "Pause" : "Play"} onClick={togglePlayback}>
                                {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                            </IconButton>
                        )}
                    </div>

                    <div className="hidden md:flex fixed bottom-0 left-0 right-0 h-20 bg-[#0a0a0d] border-t border-white/5 items-center justify-between px-6 z-30">
                        <button type="button" onClick={() => setShowFullPlayer(true)} className="flex items-center gap-3 w-1/4 min-w-0 text-left">
                            <div className="relative">
                                <Cover src={currentSong.thumbnail} alt="" width={44} height={44} className="w-11 h-11 object-cover rounded-lg bg-zinc-800" />
                                {isBusy && (
                                    <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                                        <SpinnerIcon size={14} />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold truncate">{displaySong?.title}</p>
                                <p className="text-[11px] text-gray-400 truncate">{displaySong?.artist}</p>
                            </div>
                        </button>
                        <IconButton
                            label={currentLiked ? "Unlike" : "Like"}
                            active={currentLiked}
                            onClick={() => toggleLike(currentSong)}
                        >
                            <HeartIcon size={18} filled={currentLiked} />
                        </IconButton>

                        <div className="flex flex-col items-center gap-1.5 flex-1 max-w-xl px-4">
                            <div className="flex items-center gap-1">
                                <IconButton label="Shuffle" active={isShuffled} onClick={toggleShuffle}>
                                    <ShuffleIcon size={16} />
                                </IconButton>
                                <IconButton label="Previous" disabled={!canSkipPrev && currentTime <= 3} onClick={skipPrevious}>
                                    <SkipPrevIcon size={18} />
                                </IconButton>
                                {playStatus === "error" ? (
                                    <IconButton label="Retry" onClick={() => playSong(asTrack(currentSong, lastQueryRef.current))} className="w-10 h-10 bg-teal text-black">
                                        <RetryIcon size={18} />
                                    </IconButton>
                                ) : (
                                    <button
                                        type="button"
                                        aria-label={isPlaying ? "Pause" : "Play"}
                                        onClick={togglePlayback}
                                        className="w-10 h-10 rounded-full bg-teal text-black flex items-center justify-center hover:scale-[1.04] active:scale-95 transition-transform"
                                    >
                                        {isBusy ? <SpinnerIcon size={16} /> : isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                                    </button>
                                )}
                                <IconButton label="Next" disabled={!canSkipNext} onClick={skipNext}>
                                    <SkipNextIcon size={18} />
                                </IconButton>
                                <IconButton label="Repeat" active={isLooping} onClick={() => setIsLooping(!isLooping)}>
                                    <RepeatIcon size={16} />
                                </IconButton>
                            </div>
                            <div className="flex items-center gap-2 w-full text-[10px] text-gray-500 tabular-nums">
                                <span>{formatTime(currentTime)}</span>
                                <input
                                    type="range"
                                    min={0}
                                    max={duration || 0}
                                    value={currentTime}
                                    onChange={handleSeek}
                                    aria-label="Seek"
                                    className="progress-slider flex-1"
                                    style={{ ["--progress" as string]: `${seekPercent}%` }}
                                />
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-1 w-1/4 justify-end">
                            <IconButton
                                label={volume === 0 ? "Unmute" : "Mute"}
                                onClick={() =>
                                {
                                    const next = volume === 0 ? 1 : 0;
                                    setVolume(next);
                                    if (audioRef.current)
                                    {
                                        audioRef.current.volume = next;
                                    }
                                }}
                            >
                                <VolumeIcon size={16} isMuted={volume === 0} />
                            </IconButton>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={volume}
                                onChange={handleVolumeChange}
                                aria-label="Volume"
                                className="progress-slider w-24"
                                style={{ ["--progress" as string]: `${volume * 100}%` }}
                            />
                            <IconButton label="Lyrics" onClick={openLyrics}>
                                <LyricsIcon size={16} />
                            </IconButton>
                            <IconButton label="Queue" active={showQueue} onClick={() => setShowQueue(true)}>
                                <QueueIcon size={16} />
                            </IconButton>
                            <IconButton label="Now playing" onClick={() => setShowFullPlayer(true)}>
                                <ExpandIcon size={16} />
                            </IconButton>
                        </div>
                    </div>
                </>
            )}

            <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#0a0a0d]/95 border-t border-white/5 flex justify-around items-center z-20">
                {[
                    { id: "home" as const, label: "Home", icon: <HomeIcon size={20} />, action: goHome },
                    { id: "search" as const, label: "Search", icon: <SearchIcon size={20} />, action: () => { setActiveTab("search"); setActiveAlbum(null); } },
                    { id: "library" as const, label: "Library", icon: <LibraryIcon size={20} />, action: () => { setActiveTab("library"); setLibraryView("root"); setActiveAlbum(null); clearSuggestions(); } },
                ].map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={item.action}
                        className={`flex flex-col items-center justify-center w-20 h-full gap-0.5 ${
                            activeTab === item.id ? "text-teal" : "text-gray-500"
                        }`}
                    >
                        {item.icon}
                        <span className="text-[11px]">{item.label}</span>
                    </button>
                ))}
            </nav>

            {currentSong && showFullPlayer && (
                <div className="fixed inset-0 bg-[#070708] z-50 flex justify-center overflow-hidden">
                    <div className="w-full max-w-md h-full flex flex-col justify-between p-6 pb-8 min-h-0">
                        <div className="flex items-center justify-between h-14">
                            <IconButton label="Close now playing" onClick={() => setShowFullPlayer(false)}>
                                <ChevronDownIcon size={22} />
                            </IconButton>
                            <span className="text-[11px] font-semibold tracking-[0.18em] text-gray-400">
                                {showLyrics ? "LYRICS" : "NOW PLAYING"}
                            </span>
                            <div className="flex items-center">
                                <IconButton
                                    label={showLyrics ? "Hide lyrics" : "Show lyrics"}
                                    active={showLyrics}
                                    onClick={() => setShowLyrics(!showLyrics)}
                                >
                                    <LyricsIcon size={20} />
                                </IconButton>
                                <IconButton label="Queue" onClick={() => setShowQueue(true)}>
                                    <QueueIcon size={20} />
                                </IconButton>
                            </div>
                        </div>

                        {showLyrics ? (
                            <div
                                ref={lyricsPaneRef}
                                className="lyric-pane flex-1 min-h-0 overflow-y-auto py-8 px-2"
                                onWheel={markLyricsUserScroll}
                                onTouchMove={markLyricsUserScroll}
                            >
                                {lyricsLoading ? (
                                    <div className="h-full min-h-[220px] flex flex-col items-center justify-center gap-3">
                                        <SpinnerIcon size={28} />
                                        <p className="text-sm text-gray-400">Finding lyrics</p>
                                    </div>
                                ) : lyrics?.status === "instrumental" ? (
                                    <div className="h-full min-h-[220px] flex items-center justify-center">
                                        <p className="text-sm text-gray-400 text-center">This track is instrumental.</p>
                                    </div>
                                ) : lyrics?.status === "ok" && lyrics.lines.length > 0 ? (
                                    <div className="flex flex-col">
                                        {lyrics.lines.map((line, index) =>
                                        {
                                            const active = lyrics.synced && index === lyricIndex;
                                            const past = lyrics.synced && index < lyricIndex;
                                            const className = lyrics.synced
                                                ? `lyric-line ${active ? "active" : past ? "past" : ""}`
                                                : "lyric-line plain";

                                            if (!lyrics.synced)
                                            {
                                                return (
                                                    <p key={`${index}-${normalizeTrackText(line.text)}`} className={className}>
                                                        {normalizeTrackText(line.text)}
                                                    </p>
                                                );
                                            }

                                            return (
                                                <button
                                                    key={`${index}-${line.time}-${normalizeTrackText(line.text)}`}
                                                    type="button"
                                                    ref={(node) =>
                                                    {
                                                        if (active)
                                                        {
                                                            activeLyricRef.current = node;
                                                        }
                                                    }}
                                                    className={className}
                                                    onClick={() => seekToLyric(line.time)}
                                                >
                                                    {normalizeTrackText(line.text)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="h-full min-h-[220px] flex items-center justify-center">
                                        <p className="text-sm text-gray-400 text-center">Lyrics are not available for this track.</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center py-4">
                                <div className="relative">
                                    <Cover
                                        src={currentSong.thumbnail}
                                        alt=""
                                        width={280}
                                        height={280}
                                        className="w-[min(72vw,280px)] h-[min(72vw,280px)] object-cover rounded-2xl shadow-glow-cyan bg-zinc-800"
                                    />
                                    {isBusy && (
                                        <div className="absolute inset-0 bg-black/45 rounded-2xl flex flex-col items-center justify-center gap-2">
                                            <SpinnerIcon size={28} />
                                            <span className="text-xs text-white/80">{playerStatusLabel}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-between items-center px-2 mb-2">
                            <div className="min-w-0 flex-1 pr-4">
                                <h2 className="text-xl font-bold truncate">{displaySong?.title}</h2>
                                <p className="text-sm text-teal truncate mt-1">{displaySong?.artist || "ZIZO Music"}</p>
                            </div>
                            <IconButton
                                label={currentLiked ? "Unlike" : "Like"}
                                active={currentLiked}
                                onClick={() => toggleLike(currentSong)}
                            >
                                <HeartIcon size={22} filled={currentLiked} />
                            </IconButton>
                        </div>

                        {playStatus === "error" && (
                            <div className="mx-2 mb-3 flex items-center justify-between gap-3 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
                                <p className="text-xs text-red-300">Could not play this track.</p>
                                <button
                                    type="button"
                                    onClick={() => playSong(asTrack(currentSong, lastQueryRef.current))}
                                    className="text-xs font-semibold text-teal"
                                >
                                    Retry
                                </button>
                            </div>
                        )}

                        <div className="flex flex-col px-2 mb-4">
                            <input
                                type="range"
                                min={0}
                                max={duration || 0}
                                value={currentTime}
                                onChange={handleSeek}
                                aria-label="Seek"
                                className="progress-slider w-full"
                                style={{ ["--progress" as string]: `${seekPercent}%` }}
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-2 tabular-nums">
                                <span>{formatTime(currentTime)}</span>
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between px-2 mb-6">
                            <IconButton label="Shuffle" active={isShuffled} onClick={toggleShuffle}>
                                <ShuffleIcon size={20} />
                            </IconButton>
                            <IconButton label="Previous" onClick={skipPrevious}>
                                <SkipPrevIcon size={24} />
                            </IconButton>
                            <button
                                type="button"
                                aria-label={isPlaying ? "Pause" : "Play"}
                                onClick={playStatus === "error" ? () => playSong(asTrack(currentSong, lastQueryRef.current)) : togglePlayback}
                                className="w-16 h-16 rounded-full bg-teal text-black flex items-center justify-center shadow-lg shadow-teal/25"
                            >
                                {playStatus === "error" ? <RetryIcon size={26} /> : isBusy ? <SpinnerIcon size={26} /> : isPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
                            </button>
                            <IconButton label="Next" disabled={!canSkipNext} onClick={skipNext}>
                                <SkipNextIcon size={24} />
                            </IconButton>
                            <IconButton label="Repeat" active={isLooping} onClick={() => setIsLooping(!isLooping)}>
                                <RepeatIcon size={20} />
                            </IconButton>
                        </div>

                        <div className="flex items-center gap-3 px-2">
                            <VolumeIcon size={16} isMuted={volume === 0} />
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={volume}
                                onChange={handleVolumeChange}
                                aria-label="Volume"
                                className="progress-slider flex-1"
                                style={{ ["--progress" as string]: `${volume * 100}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {showQueue && (
                <div className="fixed inset-0 z-[60] bg-black/70 flex items-end md:items-center justify-center p-0 md:p-6" onClick={() => setShowQueue(false)}>
                    <div
                        className="w-full max-w-md bg-[#121214] rounded-t-3xl md:rounded-3xl border border-white/10 p-5 max-h-[70vh] overflow-y-auto"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-semibold">Up next</h3>
                            <IconButton label="Close queue" onClick={() => setShowQueue(false)}>
                                <CloseIcon size={18} />
                            </IconButton>
                        </div>
                        {currentSong && (
                            <div className="mb-4">
                                <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Playing</p>
                                {renderTrackRow(asTrack(currentSong, lastQueryRef.current))}
                            </div>
                        )}
                        {queueItems.length === 0 ? (
                            <p className="text-sm text-gray-400 py-6 text-center">Nothing else in the queue. Play a list or keep autoplay on for recommendations.</p>
                        ) : (
                            <div className="flex flex-col">
                                {queueItems.map((track, index) => renderTrackRow(track, { index, list: playList.length ? playList : recommendations }))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showAddSongModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
                    <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4">
                        <h3 className="text-lg font-bold text-center">Add song to album</h3>
                        {modalError && <p className="text-xs text-red-400 text-center">{modalError}</p>}
                        <input
                            type="search"
                            value={songQuery}
                            onChange={(event) => handleSongQueryChange(event.target.value)}
                            placeholder="Search title or artist"
                            aria-label="Search songs to add"
                            className="bg-[#1c1c1f] border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal/30"
                            autoFocus
                        />
                        <div className="max-h-56 overflow-y-auto flex flex-col gap-1">
                            {songSuggestions.length > 0
                                ? songSuggestions.map((suggestion) => (
                                    <button
                                        key={suggestion.id}
                                        type="button"
                                        onClick={() => handleAddSongToAlbum(suggestion)}
                                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 text-left"
                                    >
                                        <Cover src={suggestion.thumbnail} alt="" width={36} height={36} className="w-9 h-9 rounded-md object-cover" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm truncate">{normalizeTrackText(suggestion.title)}</p>
                                            <p className="text-xs text-gray-500 truncate">{normalizeTrackText(suggestion.artist)}</p>
                                        </div>
                                        <PlusIcon size={16} className="text-teal" />
                                    </button>
                                ))
                                : recommendations.slice(0, 4).map((track) => (
                                    <button
                                        key={trackKey(track)}
                                        type="button"
                                        onClick={() => handleAddSongToAlbum(track)}
                                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 text-left"
                                    >
                                        <Cover src={track.thumbnail} alt="" width={36} height={36} className="w-9 h-9 rounded-md object-cover" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm truncate">{asTrack(track).title}</p>
                                            <p className="text-xs text-gray-500 truncate">{asTrack(track).artist}</p>
                                        </div>
                                        <PlusIcon size={16} className="text-teal" />
                                    </button>
                                ))}
                        </div>
                        <button type="button" onClick={() => setShowAddSongModal(false)} className="py-2 text-sm text-gray-400 hover:text-white">
                            Close
                        </button>
                    </div>
                </div>
            )}

            {showCreateAlbumModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
                    <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4">
                        <h3 className="text-lg font-bold text-center">Create album</h3>
                        {modalError && (
                            <p className="text-xs text-red-400 text-center bg-red-500/10 border border-red-500/20 py-1.5 px-3 rounded-lg">{modalError}</p>
                        )}
                        <label className="text-[11px] font-semibold text-lavender uppercase tracking-wider">
                            Album title
                            <input
                                type="text"
                                placeholder="e.g. Night drives"
                                value={newAlbumTitle}
                                onChange={(event) => setNewAlbumTitle(event.target.value)}
                                className="mt-1.5 w-full bg-[#1c1c1f] border border-white/5 rounded-xl px-3 py-2 text-sm text-white"
                            />
                        </label>
                        <label className="text-[11px] font-semibold text-lavender uppercase tracking-wider">
                            Year
                            <input
                                type="text"
                                inputMode="numeric"
                                placeholder={new Date().getFullYear().toString()}
                                value={newAlbumYear}
                                onChange={(event) => setNewAlbumYear(event.target.value)}
                                className="mt-1.5 w-full bg-[#1c1c1f] border border-white/5 rounded-xl px-3 py-2 text-sm text-white"
                            />
                        </label>
                        <div>
                            <p className="text-[11px] font-semibold text-lavender uppercase tracking-wider mb-2">Cover</p>
                            <div className="flex gap-2">
                                {ALBUM_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => setNewAlbumCover(preset)}
                                        className={`w-12 h-12 rounded-lg overflow-hidden border-2 ${newAlbumCover === preset ? "border-teal" : "border-transparent"}`}
                                    >
                                        <Cover src={preset} alt="" width={48} height={48} className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                            <input
                                type="url"
                                placeholder="Or paste a cover image URL"
                                value={ALBUM_PRESETS.includes(newAlbumCover) ? "" : newAlbumCover}
                                onChange={(event) => setNewAlbumCover(event.target.value)}
                                className="mt-2 w-full bg-[#1c1c1f] border border-white/5 rounded-xl px-3 py-2 text-xs text-white"
                            />
                        </div>
                        <div className="flex gap-3 mt-2">
                            <button type="button" onClick={() => setShowCreateAlbumModal(false)} className="flex-1 py-2 text-sm rounded-xl bg-[#1c1c1f] text-gray-400">
                                Cancel
                            </button>
                            <button type="button" onClick={handleCreateAlbum} className="flex-1 py-2 text-sm font-bold rounded-xl bg-teal text-black">
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {albumToDelete && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4">
                    <div className="bg-[#121214] border border-white/10 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4">
                        <h3 className="text-lg font-bold text-center">Delete album?</h3>
                        <p className="text-sm text-gray-400 text-center">
                            “{albumToDelete.title}” and its track list will be removed from this device. This cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setAlbumToDelete(null)} className="flex-1 py-2 text-sm rounded-xl bg-[#1c1c1f] text-gray-400">
                                Cancel
                            </button>
                            <button type="button" onClick={confirmDeleteAlbum} className="flex-1 py-2 text-sm font-bold rounded-xl bg-red-500 text-white">
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
