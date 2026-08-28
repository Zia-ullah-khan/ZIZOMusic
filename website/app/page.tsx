"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

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
  title: string;
  year: string;
  thumbnail: string;
}

const ALBUM_PRESETS = [
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300", // Preset 1
  "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300", // Preset 2
  "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300", // Preset 3
  "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=300", // Preset 4
];

const API_URL = "https://api.zizomusic.com";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"home" | "search" | "library">("home");
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [isShuffled, setIsShuffled] = useState(false);
  const [likedTracks, setLikedTracks] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");

  const [albums, setAlbums] = useState<Album[]>([]);
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [newAlbumYear, setNewAlbumYear] = useState("");
  const [newAlbumCover, setNewAlbumCover] = useState("https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300");
  const [modalError, setModalError] = useState("");
  const [status, setStatus] = useState("");
  const [recentSongs, setRecentSongs] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(null);
  const [userID, setUserID] = useState<string>("");
  const [isLooping, setIsLooping] = useState(false);
  const [isAutoplay, setIsAutoplay] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const historyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionTimerRef = useRef<NodeJS.Timeout | null>(null);

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
            localStorage.setItem("userID", data.user_id);
        }
      }
    } catch (e) {
      console.error("Failed to fetch recommendations", e);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("recentSongs");
    if (saved) {
      setRecentSongs(JSON.parse(saved));
    }
    
    const savedUserID = localStorage.getItem("userID") || "";
    setUserID(savedUserID);
    fetchRecommendations(savedUserID);

    const savedLiked = localStorage.getItem("likedTracks");
    if (savedLiked) {
      setLikedTracks(new Set(JSON.parse(savedLiked)));
    }

    const savedAlbums = localStorage.getItem("createdAlbums");
    if (savedAlbums) {
      setAlbums(JSON.parse(savedAlbums));
    }
  }, []);

  const addToHistory = (songName: string) => {
    setRecentSongs(prev => {
      const newHistory = [songName, ...prev.filter(s => s !== songName)].slice(0, 10);
      localStorage.setItem("recentSongs", JSON.stringify(newHistory));
      return newHistory;
    });
    fetchRecommendations(userID);
  };

  const handleCreateAlbum = () => {
    if (!newAlbumTitle.trim()) {
      setModalError("Please enter an album title.");
      return;
    }
    const newAlbum: Album = {
      title: newAlbumTitle.trim(),
      year: newAlbumYear.trim() || new Date().getFullYear().toString(),
      thumbnail: newAlbumCover.trim(),
    };
    const updatedAlbums = [newAlbum, ...albums];
    setAlbums(updatedAlbums);
    localStorage.setItem("createdAlbums", JSON.stringify(updatedAlbums));

    // Reset inputs & close
    setNewAlbumTitle("");
    setNewAlbumYear("");
    setNewAlbumCover(ALBUM_PRESETS[0]);
    setModalError("");
    setShowCreateAlbumModal(false);
  };

  const playSong = async (songInput: string | Recommendation, isAutoplayTriggered = false) => {
    let songName = "";
    let songInfo: SongInfo | null = null;

    if (typeof songInput === "string") {
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

    if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = null;
    }

    setQuery(songName);
    if (songInfo) setCurrentSong(songInfo);
    setStatus("Searching & Loading...");
    setRecommendations(prev => prev.filter(r => r.query !== songName));

    if (!isAutoplayTriggered) {
        addToHistory(songName);
    } else {
        historyTimeoutRef.current = setTimeout(() => {
            addToHistory(songName);
        }, 60000);
    }

    let songUrl = `${API_URL}/stream/${encodeURIComponent(songName)}`;
    if (userID) {
        songUrl += `?user_id=${userID}`;
    }
    
    if (audioRef.current) {
      audioRef.current.src = songUrl;
      audioRef.current.play().then(() => {
        setStatus("Playing");
        setIsPlaying(true);

        if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: songInfo?.title || songName,
                artist: songInfo?.artist || "ZIZO Music",
                artwork: songInfo?.thumbnail ? [
                    { src: songInfo.thumbnail, sizes: "512x512", type: "image/jpeg" }
                ] : []
            });
        }
      }).catch(e => {
        console.error(e);
        setStatus("Error playing");
      });
    }
  };

  const updateMediaSessionPosition = () => {
    if ("mediaSession" in navigator && audioRef.current && !isNaN(audioRef.current.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audioRef.current.duration,
          playbackRate: audioRef.current.playbackRate,
          position: audioRef.current.currentTime,
        });
      } catch (e) {
        // Ignore
      }
    }
  };

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play());
      navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime && audioRef.current) {
          audioRef.current.currentTime = details.seekTime;
        }
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
    };
  }, []);

  const handleSongEnd = () => {
    setIsPlaying(false);
    if (isAutoplay && recommendations.length > 0) {
        playSong(recommendations[0], true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  };

  const togglePlayback = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch(err => console.error(err));
      }
    }
  };

  const toggleLoop = () => {
    setIsLooping(!isLooping);
  };

  const toggleLike = (title: string) => {
    const newLiked = new Set(likedTracks);
    if (newLiked.has(title)) {
      newLiked.delete(title);
    } else {
      newLiked.add(title);
    }
    setLikedTracks(newLiked);
    localStorage.setItem("likedTracks", JSON.stringify(Array.from(newLiked)));
  };

  const skipNext = () => {
    if (recommendations.length > 0) {
      playSong(recommendations[0]);
    }
  };

  const skipPrevious = () => {
    if (audioRef.current) {
      if (audioRef.current.currentTime > 3) {
        audioRef.current.currentTime = 0;
      }
    }
  };

  const selectGenre = (genre: string) => {
    setQuery(genre);
    setActiveTab("search");
    fetchSuggestions(genre);
  };

  const clearSuggestions = () => {
    if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
    setSuggestions([]);
  };

  const fetchSuggestions = async (text: string) => {
    try {
      const res = await fetch(`${API_URL}/search/suggestions?q=${encodeURIComponent(text)}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setQuery(text);
    if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);

    if (text.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    suggestionTimerRef.current = setTimeout(() => {
      fetchSuggestions(text.trim());
    }, 220);
  };

  const playSuggestion = (s: Suggestion) => {
    playSong({
      title: s.title,
      artist: s.artist,
      thumbnail: s.thumbnail,
      query: `${s.title} ${s.artist}`.trim(),
    });
    setSuggestions([]);
  };

  const getLibraryTracks = () => {
    if (recommendations.length > 0) {
      return recommendations.slice(0, 10);
    }
    return [
      { title: "Astral Drift", artist: "Hyperion", query: "Astral Drift Hyperion", thumbnail: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150" },
      { title: "Virtual Horizon", artist: "Kozmos", query: "Virtual Horizon Kozmos", thumbnail: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150" },
      { title: "Synthesized Mind", artist: "Vector Unit", query: "Synthesized Mind Vector Unit", thumbnail: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150" },
      { title: "Retro Future", artist: "Daft Punk", query: "Retro Future Daft Punk", thumbnail: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150" },
      { title: "Neon Wanderer", artist: "Stellar", query: "Neon Wanderer Stellar", thumbnail: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150" },
    ];
  };

  const getArtistDetails = () => {
    const defaultArtist = "Aetheris";
    const defaultArt = "/images/aetheris.jpg";
    const currentArtist = currentSong && currentSong.artist !== "ZIZO Music" ? currentSong.artist : defaultArtist;
    const currentArt = currentSong && currentSong.artist !== "ZIZO Music" ? currentSong.thumbnail : defaultArt;

    const popularTracks = recommendations.slice(0, 3).map((rec, idx) => ({
      id: `0${idx + 1}`,
      title: rec.title,
      artist: rec.artist,
      plays: `${(15.2 - idx * 3.4).toFixed(1)}M`,
      thumbnail: rec.thumbnail,
      query: rec.query,
    }));

    if (popularTracks.length === 0) {
      popularTracks.push(
        { id: "01", title: "Lost In Translation", artist: currentArtist, plays: "14.2M", thumbnail: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150", query: `Lost In Translation ${currentArtist}` },
        { id: "02", title: "Static Dreams", artist: currentArtist, plays: "8.9M", thumbnail: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150", query: `Static Dreams ${currentArtist}` },
        { id: "03", title: "Subzero", artist: currentArtist, plays: "5.1M", thumbnail: "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150", query: `Subzero ${currentArtist}` }
      );
    }

    return {
      name: currentArtist,
      banner: currentArt,
      listeners: "1,452,098 monthly listeners",
      popularTracks,
      albums: albums
    };
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "0:00";
    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const artist = getArtistDetails();
  const libraryTracks = getLibraryTracks();

  return (
    <div className="flex h-screen w-screen bg-[#070708] text-white overflow-hidden select-none">
      <audio
        ref={audioRef}
        loop={isLooping}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
        onPlay={() => {
            setIsPlaying(true);
            setStatus("Playing");
            if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
            updateMediaSessionPosition();
        }}
        onPause={() => {
            setIsPlaying(false);
            setStatus("Paused");
            if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
            updateMediaSessionPosition();
        }}
        onEnded={handleSongEnd}
        onSeeked={updateMediaSessionPosition}
        onRateChange={updateMediaSessionPosition}
        onError={() => setStatus("Error loading song")}
      />

      {/* LEFT SIDEBAR (Desktop) */}
      <aside className="hidden md:flex flex-col w-64 bg-[#0a0a0d] border-r border-white/5 p-6 shrink-0">
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.png" alt="ZIZO Music Logo" className="w-8 h-8 rounded" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-teal to-sky-blue bg-clip-text text-transparent">ZIZO Music</span>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          <button
            onClick={() => { setActiveTab("home"); clearSuggestions(); }}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "home" ? "bg-white/5 text-teal" : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="text-lg">⌂</span>
            <span>Home</span>
          </button>

          <button
            onClick={() => { setActiveTab("search"); }}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "search" ? "bg-white/5 text-teal" : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="text-lg">🔍</span>
            <span>Search</span>
          </button>

          <button
            onClick={() => { setActiveTab("library"); clearSuggestions(); }}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "library" ? "bg-white/5 text-teal" : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <span className="text-lg">⊗</span>
            <span>Library</span>
          </button>
        </nav>

        <div className="text-xs text-gray-500 border-t border-white/5 pt-4">
          <p>Streaming via FastAPI</p>
          <Link href="/legal" className="hover:underline text-gray-400 mt-1 block">ToS & Privacy</Link>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto pb-28 md:pb-24">
        {/* TOP STATUS BAR (Web) */}
        {status && (
          <div className="bg-[#121214]/80 backdrop-blur-md px-6 py-2 border-b border-white/5 text-xs text-gray-400 z-10 sticky top-0 flex justify-between items-center">
            <span>Status: {status}</span>
            {userID && <span className="opacity-50">User: {userID.slice(0, 8)}...</span>}
          </div>
        )}

        <div className="flex-1">
          {/* HOME / ARTIST VIEW (Screen 5 Layout) */}
          {activeTab === "home" && (
            <div className="flex flex-col">
              <div 
                className="relative h-[300px] md:h-[400px] bg-cover bg-center flex items-end p-8 border-b border-white/5"
                style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.2), rgba(7,7,8,1)), url(${artist.banner})` }}
              >
                <div className="flex flex-col gap-2 max-w-4xl w-full">
                  <div className="flex items-center gap-1 text-xs font-bold tracking-widest text-teal">
                    <span>✓</span> VERIFIED ARTIST
                  </div>
                  <h1 className="text-4xl md:text-6xl font-black uppercase text-white tracking-tighter select-text">
                    {artist.name}
                  </h1>
                  <span className="text-sm text-gray-300">{artist.listeners}</span>
                </div>
              </div>

              <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-8">
                {/* Popular Tracks Table */}
                <div>
                  <h2 className="text-xl md:text-2xl font-bold mb-4">Popular Tracks</h2>
                  <div className="flex flex-col gap-2">
                    {artist.popularTracks.map((track) => (
                      <div
                        key={track.id}
                        onClick={() => playSong({ title: track.title, artist: track.artist, thumbnail: track.thumbnail, query: track.query })}
                        className="flex items-center gap-4 p-3 rounded-xl bg-[#101012] border border-white/3 hover:bg-white/5 transition-colors cursor-pointer group"
                      >
                        <span className="w-8 text-center text-sm text-gray-500 font-bold group-hover:text-white transition-colors">{track.id}</span>
                        <img src={track.thumbnail} alt={track.title} className="w-11 h-11 object-cover rounded-lg bg-zinc-800" />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold truncate text-white">{track.title}</h4>
                          <span className="text-xs text-gray-500">{track.plays} plays</span>
                        </div>
                        <div className="w-8 h-8 rounded-full border border-white/30 flex items-center justify-center group-hover:border-teal group-hover:bg-teal group-hover:text-black transition-all">
                          <span className="text-xs pl-0.5">▶</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Albums section */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl md:text-2xl font-bold">Albums</h2>
                    <button
                      onClick={() => {
                        setNewAlbumTitle("");
                        setNewAlbumYear("");
                        setNewAlbumCover(ALBUM_PRESETS[0]);
                        setModalError("");
                        setShowCreateAlbumModal(true);
                      }}
                      className="px-3 py-1 text-xs font-semibold rounded-full bg-teal text-black hover:bg-opacity-90 transition-all shadow-sm cursor-pointer"
                    >
                      + Create Album
                    </button>
                  </div>
                  {artist.albums.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 border border-dashed border-white/10 rounded-2xl bg-[#101012] text-center w-full">
                      <span className="text-3xl mb-2">💿</span>
                      <p className="text-sm font-semibold text-white">No albums created yet</p>
                      <p className="text-xs text-gray-500 mt-1">Add custom albums to showcase Aetheris's music catalogue</p>
                      <button
                        onClick={() => {
                          setNewAlbumTitle("");
                          setNewAlbumYear("");
                          setNewAlbumCover(ALBUM_PRESETS[0]);
                          setModalError("");
                          setShowCreateAlbumModal(true);
                        }}
                        className="mt-4 px-4 py-1.5 text-xs font-bold rounded-lg bg-white/5 border border-white/10 text-teal hover:bg-white/10 transition-all cursor-pointer"
                      >
                        Create Album
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                      {artist.albums.map((album, idx) => (
                        <div
                          key={idx}
                          onClick={() => selectGenre(album.title)}
                          className="w-[140px] md:w-[160px] shrink-0 p-3 rounded-2xl bg-[#101012] border border-white/3 hover:bg-white/5 transition-all cursor-pointer group"
                        >
                          <img src={album.thumbnail} alt={album.title} className="w-full aspect-square object-cover rounded-xl bg-zinc-800 mb-3 shadow-md" />
                          <h4 className="text-xs font-semibold truncate text-white group-hover:text-teal transition-colors">{album.title}</h4>
                          <span className="text-[10px] text-gray-500 mt-1 block">{album.year}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SEARCH SCREEN (Screen 2 Layout) */}
          {activeTab === "search" && (
            <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-6">
              <h1 className="text-3xl md:text-4xl font-extrabold text-white">Search</h1>
              
              <div className="relative w-full max-w-lg mb-4">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                <input
                  type="text"
                  value={query}
                  onChange={handleQueryChange}
                  placeholder="Artists, songs, or podcasts"
                  className="w-full bg-[#16161a] border border-white/5 rounded-xl pl-11 pr-10 py-3 text-sm focus:outline-none focus:border-teal/30 transition-colors"
                />
                {query && (
                  <button onClick={() => { setQuery(""); clearSuggestions(); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs">
                    ✕
                  </button>
                )}
              </div>

              {suggestions.length > 0 ? (
                <div className="flex flex-col bg-[#101012] border border-white/3 rounded-2xl divide-y divide-white/5 overflow-hidden">
                  {suggestions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => playSuggestion(s)}
                      className="flex items-center gap-3 p-4 hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <img src={s.thumbnail} alt={s.title} className="w-11 h-11 object-cover rounded-lg bg-zinc-850" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold truncate text-white">{s.title}</h4>
                        <span className="text-xs text-gray-400">{s.artist}</span>
                      </div>
                      <span className="text-xs text-gray-600">{s.duration}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <h3 className="text-lg font-bold text-white">Browse all genres</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                      { title: "Synthwave", class: "bg-gradient-synthwave", thumb: "/images/cyberpunk_essentials.jpg" },
                      { title: "Lo-Fi Beats", class: "bg-gradient-lofi", thumb: "/images/neo_flora.jpg" },
                      { title: "Techno & Club", class: "bg-gradient-techno", thumb: "/images/aetheris.jpg" },
                      { title: "Indie Rock", class: "bg-gradient-indie", thumb: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150" },
                      { title: "Hip-Hop", class: "bg-gradient-hiphop", thumb: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150" },
                      { title: "Chill Ambient", class: "bg-gradient-ambient", thumb: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=150" },
                    ].map((genre, idx) => (
                      <div
                        key={idx}
                        onClick={() => selectGenre(genre.title)}
                        className={`h-28 rounded-2xl p-4 relative overflow-hidden cursor-pointer shadow-sm shadow-black/35 hover:scale-[1.02] active:scale-[0.98] transition-all ${genre.class}`}
                      >
                        <span className="text-base font-bold text-white tracking-tight">{genre.title}</span>
                        <div className="absolute -bottom-4 -right-4 w-16 h-16 shadow-lg shadow-black/40 rotate-[25deg]">
                          <img src={genre.thumb} alt={genre.title} className="w-full h-full object-cover rounded-md" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* LIBRARY / PLAYLIST VIEW (Screen 1 Layout) */}
          {activeTab === "library" && (
            <div className="p-6 md:p-8 max-w-5xl w-full mx-auto flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 pb-6 border-b border-white/5">
                <img
                  src={currentSong?.thumbnail || "/images/cyberpunk_essentials.jpg"}
                  alt="Cyberpunk Essentials Cover"
                  className="w-44 h-44 md:w-48 md:h-48 object-cover rounded-2xl shadow-xl shadow-black/40 bg-zinc-800 shrink-0"
                />
                <div className="flex flex-col text-center sm:text-left gap-2 min-w-0">
                  <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                    Cyberpunk Essentials
                  </h1>
                  <p className="text-sm text-gray-400">
                    Curated by <span className="text-teal font-medium">Waveline</span>
                  </p>
                  <span className="text-xs text-gray-500">
                    {libraryTracks.length} tracks • {formatTime(libraryTracks.length * 205)}
                  </span>
                </div>
              </div>

              {/* Playlist Action Bar */}
              <div className="flex items-center gap-4">
                <button
                  onClick={() => playSong(libraryTracks[0])}
                  className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-center text-teal text-lg pl-0.5 shadow-md transition-all active:scale-[0.95]"
                >
                  ▶
                </button>
              </div>

              {/* Playlist Tracks List */}
              <div className="flex flex-col divide-y divide-white/5 mt-2">
                {libraryTracks.map((track, index) => (
                  <div
                    key={index}
                    onClick={() => playSong({ title: track.title, artist: track.artist, thumbnail: track.thumbnail, query: track.query })}
                    className="flex items-center gap-4 py-3 hover:bg-white/5 rounded-xl px-2 transition-colors cursor-pointer group"
                  >
                    <span className="w-8 text-center text-xs text-gray-500 font-bold">{String(index + 1).padStart(2, "0")}</span>
                    <img src={track.thumbnail} alt={track.title} className="w-11 h-11 object-cover rounded-lg bg-zinc-800 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold truncate text-white group-hover:text-teal transition-colors">{track.title}</h4>
                      <span className="text-xs text-gray-500 truncate block mt-0.5">{track.artist}</span>
                    </div>
                    <button className="text-gray-500 hover:text-white p-2 text-xs">
                      ☰
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* PERSISTENT BOTTOM PLAYER BAR (Desktop/Tablet) */}
      {currentSong && (
        <div className="fixed bottom-0 left-0 right-0 h-20 bg-[#0a0a0d] border-t border-white/5 flex items-center justify-between px-6 z-30">
          {/* Left: Track Details */}
          <div 
            onClick={() => setShowFullPlayer(true)} 
            className="flex items-center gap-3 w-1/4 min-w-0 cursor-pointer group"
          >
            <img src={currentSong.thumbnail} alt={currentSong.title} className="w-11 h-11 object-cover rounded-lg bg-zinc-800 shadow" />
            <div className="hidden sm:flex flex-col min-w-0">
              <h4 className="text-xs font-semibold text-white truncate group-hover:underline">{currentSong.title}</h4>
              <span className="text-[10px] text-teal truncate mt-0.5">{currentSong.artist}</span>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); toggleLike(currentSong.title); }} 
              className="text-gray-500 hover:text-teal text-base pl-2 transition-colors focus:outline-none"
            >
              {likedTracks.has(currentSong.title) ? "♥" : "♡"}
            </button>
          </div>

          {/* Center: Playback Controls & Seeker */}
          <div className="flex flex-col items-center gap-1.5 flex-1 max-w-xl px-4">
            <div className="flex items-center gap-4 md:gap-6">
              <button onClick={() => setIsShuffled(!isShuffled)} className={`text-xs ${isShuffled ? "text-teal" : "text-gray-500 hover:text-white"}`}>
                🔀
              </button>
              <button onClick={skipPrevious} className="text-base text-gray-400 hover:text-white">
                ⏮
              </button>
              <button
                onClick={togglePlayback}
                className="w-8 h-8 rounded-full bg-teal text-black text-sm flex items-center justify-center shadow-lg shadow-teal/15 hover:scale-[1.05] active:scale-[0.95] transition-all"
              >
                {isPlaying ? "‖" : "▶"}
              </button>
              <button onClick={skipNext} className="text-base text-gray-400 hover:text-white">
                ⏭
              </button>
              <button onClick={toggleLoop} className={`text-xs ${isLooping ? "text-teal" : "text-gray-500 hover:text-white"}`}>
                🔁
              </button>
            </div>

            <div className="flex items-center gap-2 w-full text-[10px] text-gray-500">
              <span>{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={handleSeek}
                className="progress-slider flex-1"
              />
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right: Volume & Full Player Toggle */}
          <div className="flex items-center gap-3 w-1/4 justify-end min-w-0">
            <span className="text-xs text-gray-500">🔊</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={handleVolumeChange}
              className="progress-slider w-20 hidden md:block"
            />
            <button className="text-xs text-gray-500 hover:text-white pl-2">
              ☰
            </button>
            <button
              onClick={() => setShowFullPlayer(true)}
              className="text-xs text-gray-500 hover:text-teal font-medium border border-white/10 hover:border-teal/30 px-2 py-1 rounded transition-colors"
            >
              FULL
            </button>
          </div>
        </div>
      )}

      {/* MOBILE COLLAPSIBLE BOTTOM TABS */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#0a0a0d]/90 backdrop-blur-md border-t border-white/5 flex justify-around items-center z-20">
        <button
          onClick={() => { setActiveTab("home"); clearSuggestions(); }}
          className={`flex flex-col items-center justify-center w-16 h-full ${activeTab === "home" ? "text-teal" : "text-gray-500"}`}
        >
          <span className="text-xl">⌂</span>
          <span className="text-[9px] mt-0.5">Home</span>
        </button>

        <button
          onClick={() => { setActiveTab("search"); }}
          className={`flex flex-col items-center justify-center w-16 h-full ${activeTab === "search" ? "text-teal" : "text-gray-500"}`}
        >
          <span className="text-xl">🔍</span>
          <span className="text-[9px] mt-0.5">Search</span>
        </button>

        <button
          onClick={() => { setActiveTab("library"); clearSuggestions(); }}
          className={`flex flex-col items-center justify-center w-16 h-full ${activeTab === "library" ? "text-teal" : "text-gray-500"}`}
        >
          <span className="text-xl">⊗</span>
          <span className="text-[9px] mt-0.5">Library</span>
        </button>
      </nav>

      {/* NOW PLAYING FULL SCREEN SCREEN (Screen 4 Layout) */}
      {currentSong && showFullPlayer && (
        <div className="fixed inset-0 bg-[#070708] z-50 flex justify-center overflow-y-auto">
          <div className="w-full max-w-md h-full flex flex-col justify-between p-6 pb-8 text-white select-none">
            {/* Header */}
            <div className="flex items-center justify-between h-14">
              <button onClick={() => setShowFullPlayer(false)} className="text-lg p-2 hover:text-teal transition-colors">
                ▼
              </button>
              <span className="text-[10px] font-bold tracking-widest text-gray-400">NOW PLAYING</span>
              <button className="text-lg p-2 hover:text-teal transition-colors">
                ☰
              </button>
            </div>

            {/* Glowing Album Cover */}
            <div className="flex-1 flex items-center justify-center py-4">
              <img
                src={currentSong.thumbnail}
                alt={currentSong.title}
                className="w-[280px] h-[280px] object-cover rounded-2xl shadow-glow-cyan bg-zinc-800"
              />
            </div>

            {/* Song details */}
            <div className="flex justify-between items-center px-4 mb-2">
              <div className="min-w-0 flex-1 pr-6">
                <h2 className="text-xl font-bold truncate text-white">{currentSong.title}</h2>
                <h3 className="text-sm font-medium text-teal truncate mt-1">{currentSong.artist}</h3>
              </div>
              <button
                onClick={() => toggleLike(currentSong.title)}
                className={`text-2xl p-2 transition-colors ${likedTracks.has(currentSong.title) ? "text-teal" : "text-gray-500 hover:text-white"}`}
              >
                {likedTracks.has(currentSong.title) ? "♥" : "♡"}
              </button>
            </div>

            {/* Seeker Slider */}
            <div className="flex flex-col px-4 mb-4">
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={handleSeek}
                className="progress-slider w-full"
              />
              <div className="flex justify-between items-center text-xs text-gray-500 mt-2">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center justify-between px-4 mb-6">
              <button onClick={() => setIsShuffled(!isShuffled)} className={`text-xl p-2 ${isShuffled ? "text-teal" : "text-gray-500"}`}>
                🔀
              </button>
              <button onClick={skipPrevious} className="text-xl p-2 text-gray-400 hover:text-white">
                ⏮
              </button>
              <button
                onClick={togglePlayback}
                className="w-16 h-16 rounded-full bg-teal text-black text-2xl font-bold flex items-center justify-center shadow-lg shadow-teal/30 hover:scale-[1.05] active:scale-[0.95] transition-all"
              >
                {isPlaying ? "‖" : "▶"}
              </button>
              <button onClick={skipNext} className="text-xl p-2 text-gray-400 hover:text-white">
                ⏭
              </button>
              <button onClick={toggleLoop} className={`text-xl p-2 ${isLooping ? "text-teal" : "text-gray-500"}`}>
                🔁
              </button>
            </div>

            {/* Volume control */}
            <div className="flex items-center gap-3 px-4 h-10">
              <span className="text-sm text-gray-500">🔊</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={handleVolumeChange}
                className="progress-slider flex-1"
              />
              <button className="text-sm text-gray-500 hover:text-white p-2">
                ☰
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Album Modal */}
      {showCreateAlbumModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-white text-center">Create New Album</h3>
            
            {modalError && (
              <p className="text-xs text-red-500 text-center bg-red-500/10 border border-red-500/20 py-1.5 px-3 rounded-lg">{modalError}</p>
            )}
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-lavender uppercase tracking-wider">Album Title</label>
              <input
                type="text"
                placeholder="e.g. Synthwave Dreams"
                value={newAlbumTitle}
                onChange={(e) => setNewAlbumTitle(e.target.value)}
                className="bg-[#1c1c1f] border border-white/5 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-teal/30 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-lavender uppercase tracking-wider">Release Year</label>
              <input
                type="text"
                placeholder="e.g. 2026"
                value={newAlbumYear}
                onChange={(e) => setNewAlbumYear(e.target.value)}
                className="bg-[#1c1c1f] border border-white/5 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-teal/30 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-lavender uppercase tracking-wider">Select Cover Art Preset</label>
              <div className="flex gap-2.5 overflow-x-auto no-scrollbar py-1">
                {ALBUM_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setNewAlbumCover(preset)}
                    className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${newAlbumCover === preset ? "border-teal scale-95" : "border-transparent"}`}
                  >
                    <img src={preset} alt={`Preset ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-lavender uppercase tracking-wider">Or paste cover image URL</label>
              <input
                type="text"
                placeholder="https://example.com/image.jpg"
                value={newAlbumCover}
                onChange={(e) => setNewAlbumCover(e.target.value)}
                className="bg-[#1c1c1f] border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal/30 transition-colors"
              />
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowCreateAlbumModal(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl bg-[#1c1c1f] text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAlbum}
                className="flex-1 py-2 text-xs font-bold rounded-xl bg-teal text-black shadow-lg shadow-teal/10 hover:shadow-teal/20 active:scale-98 transition-all cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
