"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { GuessComparison, NumericResult, NumericStatus } from "@/lib/game/compare";

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
          <div className="w-8 h-8 flex-shrink-0 rounded overflow-hidden bg-gray-700">
            {g.headerImage && <img src={g.headerImage} alt="" className="w-full h-full object-cover" />}
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

// ── main component ────────────────────────────────────────────────────────────

export default function GameClient() {
  const [round, setRound] = useState<Round | null | undefined>(undefined);
  const [gameMode, setGameMode] = useState<"solo" | "friend">("solo");
  const [friendInput, setFriendInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchGame[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/game")
      .then((r) => r.json())
      .then((d) => setRound(d.round ?? null))
      .catch(() => setRound(null));
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
    }, 200);
  }, [query, round?.guesses]);

  async function startGame() {
    setStarting(true);
    setStartError("");
    const body = gameMode === "friend" && friendInput ? { friendSteamId: friendInput } : {};
    const r = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.error) {
      setStartError(d.error);
      setStarting(false);
      return;
    }
    setRound(d.round);
    setStarting(false);
    setTimeout(() => inputRef.current?.focus(), 100);
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

  if (round === undefined) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  const guessNum = round ? round.guesses.length : 0;

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Shelfle</h1>
            <p className="text-gray-400 text-sm mt-0.5">Guess the game from your Steam library</p>
          </div>
          <Link href="/library" className="text-sm text-gray-400 hover:text-white transition-colors">
            My Library →
          </Link>
        </div>

        {!round ? (
          <div className="flex flex-col items-center gap-5 py-20">
            {/* Mode toggle */}
            <div className="flex rounded-lg overflow-hidden border border-gray-700">
              <button
                onClick={() => setGameMode("solo")}
                className={`px-5 py-2 text-sm font-medium transition-colors ${
                  gameMode === "solo" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                Solo
              </button>
              <button
                onClick={() => setGameMode("friend")}
                className={`px-5 py-2 text-sm font-medium transition-colors ${
                  gameMode === "friend" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                Friend's Library
              </button>
            </div>

            {gameMode === "friend" && (
              <div className="w-full max-w-sm flex flex-col gap-2">
                <input
                  type="text"
                  value={friendInput}
                  onChange={(e) => { setFriendInput(e.target.value); setStartError(""); }}
                  placeholder="Steam ID, profile URL, or vanity name"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                />
                <p className="text-xs text-gray-500 text-center">
                  Their profile must be set to public
                </p>
              </div>
            )}

            {startError && (
              <p className="text-red-400 text-sm text-center max-w-sm">{startError}</p>
            )}

            <button
              onClick={startGame}
              disabled={starting || (gameMode === "friend" && !friendInput.trim())}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-10 py-3 rounded-lg transition-colors text-lg"
            >
              {starting
                ? gameMode === "friend"
                  ? "Importing library…"
                  : "Starting…"
                : "Start Game"}
            </button>
          </div>
        ) : (
          <>
            {/* Progress + mode label */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">
                  {round.status === "active"
                    ? `Guess ${guessNum + 1} / ${round.maxGuesses}`
                    : round.status === "won"
                    ? `Won in ${guessNum} guess${guessNum === 1 ? "" : "es"}`
                    : `Out of guesses`}
                </span>
                {round.mode === "friend" && round.friendName && (
                  <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
                    {round.friendName}&apos;s library
                  </span>
                )}
              </div>
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
                        <div className="w-8 h-8 flex-shrink-0 rounded overflow-hidden bg-gray-700">
                          {game.headerImage && (
                            <img src={game.headerImage} alt="" className="w-full h-full object-cover" />
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
                  <img src={round.targetHeaderImage} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" />
                )}
                <div>
                  <p className="font-semibold text-white text-lg">
                    {round.status === "won" ? "You got it!" : "The answer was:"}
                  </p>
                  <p className="text-gray-300">{round.targetTitle}</p>
                </div>
              </div>
            )}

            {round.status !== "active" && (
              <div className="flex gap-3">
                <button
                  onClick={() => { setRound(null); setGameMode("solo"); }}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2 rounded-lg transition-colors"
                >
                  Play Again
                </button>
                {round.mode === "friend" && round.friendName && (
                  <button
                    onClick={startGame}
                    className="bg-gray-700 hover:bg-gray-600 text-white font-semibold px-6 py-2 rounded-lg transition-colors"
                  >
                    Same Friend
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
