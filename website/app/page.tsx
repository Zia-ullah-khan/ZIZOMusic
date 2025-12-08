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
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [recentSongs, setRecentSongs] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(null);
  const [userID, setUserID] = useState<string>("");
  const [isLooping, setIsLooping] = useState(false);
  const [isAutoplay, setIsAutoplay] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const historyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRecommendations = async (currentUserID: string) => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://192.168.1.153:8000";
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecentSongs(JSON.parse(saved));
    }
    
    const savedUserID = localStorage.getItem("userID") || "";
    setUserID(savedUserID);
    fetchRecommendations(savedUserID);
  }, []);

  const addToHistory = (songName: string) => {
    setRecentSongs(prev => {
      const newHistory = [songName, ...prev.filter(s => s !== songName)].slice(0, 10);
      localStorage.setItem("recentSongs", JSON.stringify(newHistory));
      return newHistory;
    });
    fetchRecommendations(userID);
  };

  const playSong = async (songInput: string | Recommendation, isAutoplayTriggered = false) => {
    let songName = "";
    let songInfo: SongInfo | null = null;

    if (typeof songInput === 'string') {
        songName = songInput;
        try {
            const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://192.168.1.153:8000";
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

    // Clear previous history timer if any
    if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current);
        historyTimeoutRef.current = null;
    }

    setQuery(songName);
    if (songInfo) setCurrentSong(songInfo);
    setStatus("Searching & Loading...");
    
    // Remove from recommendations immediately to prevent re-selection
    setRecommendations(prev => prev.filter(r => r.query !== songName));

    if (!isAutoplayTriggered) {
        addToHistory(songName);
    } else {
        // Delay history addition for autoplayed songs
        historyTimeoutRef.current = setTimeout(() => {
            addToHistory(songName);
        }, 60000); // 1 minute
    }

    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://192.168.1.153:8000";
    let songUrl = `${API_URL}/stream/${encodeURIComponent(songName)}`;
    if (userID) {
        songUrl += `?user_id=${userID}`;
    }
    
    if (audioRef.current) {
      audioRef.current.src = songUrl;
      audioRef.current.play().then(() => {
        setStatus("Playing");

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: songInfo?.title || songName,
                artist: songInfo?.artist || "ZIZO Music",
                artwork: songInfo?.thumbnail ? [
                    { src: songInfo.thumbnail, sizes: '512x512', type: 'image/jpeg' }
                ] : []
            });
        }
      }).catch(e => {
        console.error(e);
        setStatus("Error playing (check console)");
      });
    }
  };

  const updateMediaSessionPosition = () => {
    if ('mediaSession' in navigator && audioRef.current && !isNaN(audioRef.current.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audioRef.current.duration,
          playbackRate: audioRef.current.playbackRate,
          position: audioRef.current.currentTime,
        });
      } catch (e) {
        // Ignore errors (e.g. duration not yet available)
      }
    }
  };

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play());
      navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
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
    if (isAutoplay && recommendations.length > 0) {
        playSong(recommendations[0], true);
    }
  };

  const handleSearch = () => {
    playSong(query);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-black text-white">
      <h1 className="text-4xl font-bold mb-8">ZIZO Music</h1>
      
      <div className="flex gap-4 mb-8 w-full max-w-md">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter song name..."
          className="flex-1 p-2 rounded bg-zinc-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-600"
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button 
          onClick={handleSearch}
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
        >
          Play
        </button>
      </div>

      {status && <p className="mb-4 text-gray-400">{status}</p>}

      {currentSong && (
        <div className="mb-6 flex flex-col items-center">
          {currentSong.thumbnail && (
            <img 
              src={currentSong.thumbnail} 
              alt={currentSong.title} 
              className="w-64 h-64 object-cover rounded-lg shadow-lg mb-4"
            />
          )}
          <h2 className="text-2xl font-bold text-center">{currentSong.title}</h2>
          <p className="text-lg text-gray-400">{currentSong.artist}</p>
        </div>
      )}

      <div className="flex gap-4 mb-4 w-full max-w-md justify-center">
        <button
            onClick={() => setIsLooping(!isLooping)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                isLooping ? "bg-red-600 text-white" : "bg-zinc-800 text-gray-400 hover:text-white"
            }`}
        >
            Loop: {isLooping ? "ON" : "OFF"}
        </button>
        <button
            onClick={() => setIsAutoplay(!isAutoplay)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                isAutoplay ? "bg-red-600 text-white" : "bg-zinc-800 text-gray-400 hover:text-white"
            }`}
        >
            Autoplay: {isAutoplay ? "ON" : "OFF"}
        </button>
      </div>

      <audio 
        ref={audioRef} 
        controls 
        loop={isLooping}
        className="w-full max-w-md"
        onPlay={() => {
            setStatus("Playing");
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing";
            updateMediaSessionPosition();
        }}
        onPause={() => {
            setStatus("Paused");
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
            updateMediaSessionPosition();
        }}
        onEnded={handleSongEnd}
        onSeeked={updateMediaSessionPosition}
        onRateChange={updateMediaSessionPosition}
        onLoadedMetadata={updateMediaSessionPosition}
        onError={() => setStatus("Error loading song")}
      />
      
      {recentSongs.length > 0 && (
        <div className="mt-8 w-full max-w-md">
          <h2 className="text-xl font-semibold mb-4">Recently Played</h2>
          <ul className="space-y-2">
            {recentSongs.map((song, index) => (
              <li 
                key={index}
                onClick={() => playSong(song)}
                className="cursor-pointer p-2 bg-zinc-900 hover:bg-zinc-800 rounded flex justify-between items-center"
              >
                <span>{song}</span>
                <span className="text-xs text-gray-500">Play</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="mt-8 w-full max-w-md">
          <h2 className="text-xl font-semibold mb-4">Recommended for You</h2>
          <ul className="space-y-2">
            {recommendations.map((rec, index) => (
              <li 
                key={index}
                onClick={() => playSong(rec.query)}
                className="cursor-pointer p-2 bg-zinc-900 hover:bg-zinc-800 rounded flex items-center gap-3"
              >
                {rec.thumbnail && (
                  <img src={rec.thumbnail} alt={rec.title} className="w-12 h-12 object-cover rounded" />
                )}
                <div className="flex flex-col">
                  <span className="font-medium">{rec.title}</span>
                  <span className="text-xs text-gray-400">{rec.artist}</span>
                </div>
                <span className="ml-auto text-xs text-gray-500">Play</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 text-sm text-gray-500 flex flex-col items-center gap-2">
        <p>Streaming via HTTP from FastAPI backend.</p>
        <Link href="/legal" className="hover:text-white underline">Terms of Service & Privacy Policy</Link>
      </div>
    </main>
  );
}
