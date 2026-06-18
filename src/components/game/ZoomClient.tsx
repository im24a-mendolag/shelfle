"use client";

import { useState, useEffect, useRef } from "react";

type ZoomGuess = {
  guessedAppId: number;
  title: string;
  headerImage: string;
  won: boolean;
};

type ZoomRound = {
  id: string;
  status: "active" | "won" | "lost";
  guesses: ZoomGuess[];
  maxGuesses: number;
  targetHeaderImage: string;
  targetTitle?: string;
  friendName?: string;
};

type SearchGame = { steamAppId: number; title: string; headerImage: string };

const ZOOM_SCALES = [8, 5, 3, 2, 1.5, 1];

function LoadingBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="w-full max-w-xs flex flex-col gap-3">
      <p className="text-sm text-gray-300 text-center">{label}</p>
      <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full bg-blue-500 transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-600 text-center">{pct}%</p>
    </div>
  );
}

export default function ZoomClient({
  defaultFriend,
  defaultFriendName,
  defaultFriendAvatar,
  initialRound,
}: {
  defaultFriend?: string;
  defaultFriendName?: string;
  defaultFriendAvatar?: string;
  initialRound?: ZoomRound;
}) {
  const [round, setRound] = useState<ZoomRound | null>(initialRound ?? null);
  const [loading, setLoading] = useState(!initialRound);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [friendDisplayName, setFriendDisplayName] = useState(defaultFriendName ?? "");
  const [friendAvatarUrl] = useState(defaultFriendAvatar ?? "");
  const [loadingPct, setLoadingPct] = useState(15);
  const [loadingLabel, setLoadingLabel] = useState("Loading…");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchGame[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [animateZoom, setAnimateZoom] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const cropPos = useRef({ x: 50, y: 50 });

  useEffect(() => {
    if (initialRound) return;
    if (defaultFriend) {
      startGame();
      return;
    }
    fetch("/api/zoom")
      .then((r) => r.json())
      .then((d) => {
        const r = d.round;
        if (r && !r.friendName) {
          setRound(r);
          setLoading(false);
        } else {
          startGame();
        }
      })
      .catch(() => startGame());
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) { setResults([]); setDropdownOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      const r = await fetch(`/api/game/search?q=${encodeURIComponent(query)}`);
      const d = await r.json();
      const filtered = (d.games ?? []).filter(
        (g: SearchGame) => !round?.guesses.some((gg) => gg.guessedAppId === g.steamAppId)
      );
      setResults(filtered);
      setDropdownOpen(filtered.length > 0);
    }, 100);
  }, [query, round?.guesses]);

  async function startGame() {
    setAnimateZoom(false);
    setStarting(true);
    setStartError("");

    const isFriend = !!defaultFriend;
    const stages = isFriend
      ? [
          { delay: 0,     pct: 8,  label: "Resolving Steam profile…" },
          { delay: 2000,  pct: 28, label: "Syncing friend's profile…" },
          { delay: 5000,  pct: 52, label: "Importing library…" },
          { delay: 11000, pct: 72, label: "Fetching game data…" },
          { delay: 19000, pct: 88, label: "Almost there…" },
        ]
      : [
          { delay: 0,   pct: 25, label: "Loading your library…" },
          { delay: 700, pct: 65, label: "Picking a game…" },
        ];

    loadingTimers.current.forEach(clearTimeout);
    loadingTimers.current = [];
    setLoadingPct(stages[0].pct);
    setLoadingLabel(stages[0].label);
    stages.slice(1).forEach(({ delay, pct, label }) => {
      loadingTimers.current.push(setTimeout(() => { setLoadingPct(pct); setLoadingLabel(label); }, delay));
    });

    const body = defaultFriend ? { friendSteamId: defaultFriend } : {};
    const r = await fetch("/api/zoom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    loadingTimers.current.forEach(clearTimeout);
    loadingTimers.current = [];

    const d = await r.json();
    if (d.error) {
      setStartError(d.error);
      setStarting(false);
      setLoading(false);
      return;
    }

    setLoadingPct(100);
    setLoadingLabel("Let's go!");
    if (d.round.friendName) setFriendDisplayName(d.round.friendName);

    setTimeout(() => {
      const margin = 100 / (2 * 8); // safe range for max scale 8 — no edge gaps
      cropPos.current = {
        x: margin + Math.random() * (100 - 2 * margin),
        y: margin + Math.random() * (100 - 2 * margin),
      };
      setRound(d.round);
      setStarting(false);
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }, 450);
  }

  async function submitGuess(game: SearchGame) {
    if (!round || round.status !== "active" || submitting) return;
    setSubmitting(true);
    setAnimateZoom(true);
    setQuery("");
    setResults([]);
    setDropdownOpen(false);

    const r = await fetch("/api/zoom/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guessedAppId: game.steamAppId }),
    });
    const d = await r.json();
    if (!d.error) {
      setRound((prev) =>
        prev
          ? {
              ...prev,
              status: d.roundStatus,
              guesses: [...prev.guesses, d.guess],
              ...(d.targetTitle ? { targetTitle: d.targetTitle } : {}),
            }
          : prev
      );
    }
    setSubmitting(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const guessCount = round?.guesses.length ?? 0;
  const scale = !round || round.status !== "active" ? 1 : (ZOOM_SCALES[guessCount] ?? 1);
  const friendName = round?.friendName ?? friendDisplayName;

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

      {!round ? (
        <div className="flex flex-col items-center gap-4 py-20 max-w-sm mx-auto w-full">
          {startError ? (
            <>
              <p className="text-red-400 text-sm text-center">{startError}</p>
              <button
                onClick={() => startGame()}
                className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Try Again
              </button>
            </>
          ) : (
            <LoadingBar pct={loadingPct} label={loadingLabel} />
          )}
        </div>
      ) : (
        <>
          {/* Friend badge + progress */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              {friendName && (
                <span className="flex items-center gap-1.5 text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
                  {friendAvatarUrl && <img src={friendAvatarUrl} alt="" className="w-4 h-4 rounded-full" />}
                  {friendName}&apos;s library
                </span>
              )}
              {round.status !== "active" && (
                <span className="text-sm text-gray-400">
                  {round.status === "won"
                    ? `Got it in ${guessCount} guess${guessCount === 1 ? "" : "es"}!`
                    : "Out of guesses"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {round.status === "active" && (
                <button
                  onClick={() => startGame()}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  New Game
                </button>
              )}
              <div className="flex gap-1">
                {Array.from({ length: round.maxGuesses }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full ${
                      i < guessCount
                        ? round.guesses[i].won ? "bg-green-500" : "bg-red-700"
                        : "bg-gray-700"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Zoomed image */}
          <div className="flex justify-center mb-5">
            <div
              className="relative rounded-xl overflow-hidden bg-gray-900 w-full"
              style={{ maxWidth: 480, aspectRatio: "16/9" }}
            >
              {round.targetHeaderImage ? (
                <img
                  src={round.targetHeaderImage}
                  alt=""
                  className="w-full h-full object-cover"
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: `${cropPos.current.x}% ${cropPos.current.y}%`,
                    transition: animateZoom ? "transform 0.8s ease-out" : "none",
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
                  No image
                </div>
              )}
            </div>
          </div>

          {/* Search input */}
          {round.status === "active" && (
            <div className="relative mb-4">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => results.length > 0 && setDropdownOpen(true)}
                onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                placeholder={friendName ? `Search ${friendName}'s library…` : "Search your library…"}
                disabled={submitting}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
              {dropdownOpen && (
                <div className="absolute top-full left-0 right-0 z-10 bg-gray-800 border border-gray-700 rounded-lg mt-1 shadow-xl overflow-hidden">
                  {results.map((game) => (
                    <button
                      key={game.steamAppId}
                      onMouseDown={() => submitGuess(game)}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-700 transition-colors text-left"
                    >
                      <div className="w-16 h-8 flex-shrink-0 rounded overflow-hidden bg-gray-900">
                        {game.headerImage && (
                          <img src={game.headerImage} alt="" className="w-full h-full object-contain" />
                        )}
                      </div>
                      <span className="text-sm text-white">{game.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Previous guesses */}
          {round.guesses.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {round.guesses.map((g) => (
                <div
                  key={g.guessedAppId}
                  className={`flex items-center gap-3 px-4 py-2 rounded-lg ${
                    g.won ? "bg-green-900 border border-green-700" : "bg-gray-800"
                  }`}
                >
                  <div className="w-12 h-6 flex-shrink-0 rounded overflow-hidden bg-gray-900">
                    {g.headerImage && (
                      <img src={g.headerImage} alt="" className="w-full h-full object-contain" />
                    )}
                  </div>
                  <span className="text-sm text-white flex-1">{g.title}</span>
                  <span className={`text-base ${g.won ? "text-green-400" : "text-red-500"}`}>
                    {g.won ? "✓" : "✗"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Win / lose banner */}
          {round.status !== "active" && (
            <div
              className={`rounded-lg p-4 mb-4 ${
                round.status === "won"
                  ? "bg-green-900 border border-green-700"
                  : "bg-gray-800 border border-gray-700"
              }`}
            >
              <p className="font-semibold text-white text-lg">
                {round.status === "won"
                  ? `Got it in ${guessCount} guess${guessCount === 1 ? "" : "es"}!`
                  : `The answer was: ${round.targetTitle}`}
              </p>
            </div>
          )}

          {/* Play again */}
          {round.status !== "active" && (
            <div className="flex gap-3">
              <button
                onClick={startGame}
                disabled={starting}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-base"
              >
                {friendName ? `Play Again — ${friendName}'s library` : "Play Again"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
