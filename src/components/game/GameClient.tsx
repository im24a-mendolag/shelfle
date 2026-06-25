"use client";

import { useState, useEffect, useRef } from "react";
import type { GuessComparison, NumericResult, NumericStatus } from "@/lib/game/compare";
import { ChallengeLinkButton } from "@/components/challenge/ChallengeLinkButton";

type Round = {
  id: string;
  status: "active" | "won" | "lost";
  mode: "solo" | "friend";
  friendName?: string;
  guesses: GuessComparison[];
  maxGuesses: number;
  targetTitle?: string;
  targetHeaderImage?: string;
};

type SearchGame = { steamAppId: number; title: string; headerImage: string };

// ── cell helpers ──────────────────────────────────────────────────────────────

function cellBg(status: NumericStatus) {
  if (status === "exact") return "bg-green-700";
  if (status === "close_higher" || status === "close_lower") return "bg-yellow-700";
  if (status === "higher" || status === "lower") return "bg-gray-700";
  return "bg-gray-800";
}

function arrow(status: NumericStatus) {
  if (status === "higher" || status === "close_higher") return " ↑";
  if (status === "lower" || status === "close_lower") return " ↓";
  return "";
}

function fmtYear(v: number | null) { return v === null ? "—" : String(v); }
function fmtPct(v: number | null) { return v === null ? "—" : `${v}%`; }
function fmtCount(v: number | null) {
  if (v === null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}
function fmtPrice(v: number | null) {
  if (v === null) return "—";
  if (v === 0) return "Free";
  return `₣${(v / 100).toFixed(2)}`;
}

function NumCell({ r, fmt }: { r: NumericResult; fmt: (v: number | null) => string }) {
  return (
    <td className={`px-3 py-2 text-center text-sm font-mono whitespace-nowrap rounded ${cellBg(r.status)}`}>
      {fmt(r.value)}{arrow(r.status)}
    </td>
  );
}

function TagsCell({ tags }: { tags: GuessComparison["tags"] }) {
  if (!tags) return <td className="px-3 py-2 rounded bg-gray-800" />;
  const bg = tags.status === "exact" ? "bg-green-700" : tags.status === "partial" ? "bg-yellow-700" : "bg-gray-700";
  return (
    <td className={`px-3 py-2 rounded ${bg}`}>
      <div className="flex gap-1 flex-wrap min-w-[180px]">
        {tags.value.slice(0, 4).map((tag) => (
          <span
            key={tag}
            className={`text-xs px-1.5 py-0.5 rounded ${
              tags.overlap.includes(tag) ? "bg-green-500 text-white" : "bg-gray-600 text-gray-300"
            }`}
          >
            {tag}
          </span>
        ))}
      </div>
    </td>
  );
}

function GuessRow({ g }: { g: GuessComparison }) {
  return (
    <tr>
      <td className={`px-3 py-2 rounded ${g.won ? "bg-green-700" : "bg-gray-800"}`}>
        <div className="flex items-center gap-2 min-w-[180px]">
          <div className="w-16 h-8 flex-shrink-0 rounded overflow-hidden bg-gray-900">
            {g.headerImage && <img src={g.headerImage} alt="" className="w-full h-full object-contain" />}
          </div>
          <span className="text-sm font-medium text-white truncate max-w-[140px]">{g.title}</span>
        </div>
      </td>
      <TagsCell tags={g.tags} />
      <NumCell r={g.releaseYear} fmt={fmtYear} />
      <NumCell r={g.reviewPct} fmt={fmtPct} />
      <NumCell r={g.totalAchievements} fmt={fmtCount} />
      <NumCell r={g.avgPlayers24h} fmt={fmtCount} />
      <NumCell r={g.priceChfCents} fmt={fmtPrice} />
    </tr>
  );
}

// ── loading bar ──────────────────────────────────────────────────────────────

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

// ── main component ────────────────────────────────────────────────────────────

export default function GameClient({ defaultFriend, defaultFriendName, defaultFriendAvatar, initialRound, challengeId }: { defaultFriend?: string; defaultFriendName?: string; defaultFriendAvatar?: string; initialRound?: Round; challengeId?: string }) {
  const [round, setRound] = useState<Round | null>(initialRound ?? null);
  const [loading, setLoading] = useState(!initialRound);
  const [gameMode] = useState<"solo" | "friend">(defaultFriend ? "friend" : "solo");
  const [friendInput] = useState(defaultFriend ?? "");
  const [friendDisplayName, setFriendDisplayName] = useState(defaultFriendName ?? "");
  const [friendAvatarUrl] = useState(defaultFriendAvatar ?? "");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [loadingPct, setLoadingPct] = useState(15);
  const [loadingLabel, setLoadingLabel] = useState("Loading…");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchGame[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialRound) return;
    if (defaultFriend) {
      startGame();
      return;
    }
    fetch("/api/game")
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
    setStarting(true);
    setStartError("");

    const isFriend = gameMode === "friend" && !!friendInput;
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

    const body = isFriend ? { friendSteamId: friendInput } : {};
    const r = await fetch("/api/game", {
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
      setRound(d.round);
      setStarting(false);
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }, 450);
  }

  async function submitGuess(game: SearchGame) {
    if (!round || round.status !== "active" || submitting) return;
    setSubmitting(true);
    setQuery("");
    setResults([]);
    setDropdownOpen(false);
    const r = await fetch("/api/game/guess", {
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
              guesses: [...prev.guesses, d.comparison],
              ...(d.targetTitle ? { targetTitle: d.targetTitle, targetHeaderImage: d.targetHeaderImage } : {}),
            }
          : prev
      );
    }
    setSubmitting(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const guessNum = round ? round.guesses.length : 0;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">

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
          {/* Progress row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {round.status !== "active" && (
                <span className="text-sm text-gray-400">
                  {round.status === "won"
                    ? `Won in ${guessNum} guess${guessNum === 1 ? "" : "es"}`
                    : `Out of guesses`}
                </span>
              )}
              {round.mode === "friend" && (round.friendName || friendDisplayName) && (
                <span className="flex items-center gap-1.5 text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
                  {friendAvatarUrl && <img src={friendAvatarUrl} alt="" className="w-4 h-4 rounded-full" />}
                  {(round.friendName || friendDisplayName)}&apos;s library
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
                      i < round.guesses.length
                        ? round.guesses[i].won ? "bg-green-500" : "bg-red-700"
                        : "bg-gray-700"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Search input */}
          {round.status === "active" && (
            <div className="relative mb-5">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => results.length > 0 && setDropdownOpen(true)}
                onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                placeholder={
                  round.mode === "friend" && round.friendName
                    ? `Search ${round.friendName}'s library…`
                    : round.mode === "friend"
                    ? "Search friend's library…"
                    : "Search your library…"
                }
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

          {/* Guess table */}
          {round.guesses.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-800 mb-4">
              <table className="w-full border-separate border-spacing-1 p-1">
                <thead>
                  <tr className="text-gray-400 uppercase text-xs">
                    <th className="px-3 py-2 text-left">Game</th>
                    <th className="px-3 py-2 text-left">Tags</th>
                    <th className="px-3 py-2 text-center">Year</th>
                    <th className="px-3 py-2 text-center">Review</th>
                    <th className="px-3 py-2 text-center">Achiev.</th>
                    <th className="px-3 py-2 text-center">Players</th>
                    <th className="px-3 py-2 text-center">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {round.guesses.map((g) => (
                    <GuessRow key={g.guessedAppId} g={g} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Win / lose banner */}
          {round.status !== "active" && (
            <div
              className={`rounded-lg p-4 mb-4 flex items-center gap-4 ${
                round.status === "won"
                  ? "bg-green-900 border border-green-700"
                  : "bg-gray-800 border border-gray-700"
              }`}
            >
              {round.targetHeaderImage && (
                <img src={round.targetHeaderImage} alt="" className="w-32 h-16 rounded object-contain bg-gray-900 flex-shrink-0" />
              )}
              <div>
                <p className="font-semibold text-white text-lg">
                  {round.status === "won" ? "You got it!" : "The answer was:"}
                </p>
                <p className="text-gray-300">{round.targetTitle}</p>
              </div>
            </div>
          )}

          {/* Post-round actions */}
          {round.status !== "active" && (
            <div className="flex flex-col gap-3 mt-4">
              {challengeId ? (
                <a
                  href={`/challenge/${challengeId}/results`}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors text-base text-center"
                >
                  View Challenge Results
                </a>
              ) : (
                <>
                  <button
                    onClick={() => startGame()}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors text-base"
                  >
                    {round.mode === "friend" && round.friendName
                      ? `Play Again — ${round.friendName}'s library`
                      : "Play Again"}
                  </button>
                  <ChallengeLinkButton key={round.id} roundId={round.id} />
                </>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
