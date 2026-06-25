"use client";

import { useState, useEffect, useRef } from "react";
import type { PlaytimeRound } from "@/app/api/playtime/route";
import { ChallengeLinkButton } from "@/components/challenge/ChallengeLinkButton";

type SearchGame = { steamAppId: number; title: string; headerImage: string };

function fmtPlayers(v: number | null | undefined): string {
  if (v === null || v === undefined) return "No data";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}

function LoadingBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="w-full max-w-xs flex flex-col gap-3">
      <p className="text-sm text-gray-300 text-center">{label}</p>
      <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
        <div className="h-2 rounded-full bg-blue-500 transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-500 text-center">{pct}%</p>
    </div>
  );
}

function ClueCard({ round, friendName }: { round: PlaytimeRound; friendName?: string }) {
  const wrongCount = round.guesses.filter((g) => !g.won).length;
  const isActive = round.status === "active";

  const playerLabel = friendName ? `${friendName} has played` : "You've played";

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden mb-5">
      {/* Playtime — always visible */}
      <div className="px-6 py-5 text-center border-b border-gray-800">
        <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">{playerLabel}</p>
        <p className="text-5xl font-black text-white tabular-nums">
          {round.playtimeHours.toLocaleString()}
        </p>
        <p className="text-gray-400 text-sm mt-1">hour{round.playtimeHours === 1 ? "" : "s"}</p>
      </div>

      {/* Clues row */}
      <div className="flex divide-x divide-gray-800">
        {/* Clue 1: avg players — unlocks after 1 wrong */}
        <div className="flex-1 px-4 py-3 text-center">
          <p className="text-xs text-gray-500 mb-1">Avg. players (24h)</p>
          {round.avgPlayers24h !== undefined ? (
            <p className="text-white font-semibold">{fmtPlayers(round.avgPlayers24h)}</p>
          ) : (
            <p className="text-gray-600 text-sm">
              {isActive ? `after ${1 - wrongCount} wrong` : "—"}
            </p>
          )}
        </div>

        {/* Clue 2: first letter — unlocks after 2 wrong */}
        <div className="flex-1 px-4 py-3 text-center">
          <p className="text-xs text-gray-500 mb-1">Starts with</p>
          {round.firstLetter ? (
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-900 text-blue-200 text-xl font-bold">
              {round.firstLetter}
            </span>
          ) : (
            <p className="text-gray-600 text-sm">
              {isActive ? `after ${2 - wrongCount} wrong` : "—"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PlaytimeClient({
  defaultFriend,
  defaultFriendName,
  defaultFriendAvatar,
  initialRound,
  challengeId,
}: {
  defaultFriend?: string;
  defaultFriendName?: string;
  defaultFriendAvatar?: string;
  initialRound?: PlaytimeRound;
  challengeId?: string;
}) {
  const [round, setRound] = useState<PlaytimeRound | null>(initialRound ?? null);
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialRound) return;
    if (defaultFriend) { startGame(); return; }
    fetch("/api/playtime")
      .then((r) => r.json())
      .then((d) => {
        if (d.round && !d.round.friendName) { setRound(d.round); }
        else { startGame(); }
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

    const isFriend = !!defaultFriend;
    const stages = isFriend
      ? [
          { delay: 0,     pct: 8,  label: "Resolving Steam profile…" },
          { delay: 2000,  pct: 28, label: "Syncing friend's profile…" },
          { delay: 5000,  pct: 52, label: "Importing library…" },
          { delay: 11000, pct: 75, label: "Almost there…" },
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
    const r = await fetch("/api/playtime", {
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
      return;
    }

    setLoadingPct(100);
    setLoadingLabel("Let's go!");
    if (d.round.friendName) setFriendDisplayName(d.round.friendName);

    setTimeout(() => {
      setRound(d.round);
      setStarting(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }, 450);
  }

  async function submitGuess(game: SearchGame) {
    if (!round || round.status !== "active" || submitting) return;
    setSubmitting(true);
    setQuery("");
    setResults([]);
    setDropdownOpen(false);

    const r = await fetch("/api/playtime/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guessedAppId: game.steamAppId }),
    });
    const d = await r.json();
    if (!d.error) setRound(d.round);
    setSubmitting(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const friendName = round?.friendName ?? friendDisplayName;
  const guessCount = round?.guesses.length ?? 0;

  if (starting || !round) {
    return (
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col items-center gap-4 py-20 max-w-sm mx-auto w-full">
          {startError ? (
            <>
              <p className="text-red-400 text-sm text-center">{startError}</p>
              <button onClick={startGame} className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold py-3 rounded-lg transition-colors">
                Try Again
              </button>
            </>
          ) : (
            <LoadingBar pct={loadingPct} label={loadingLabel} />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
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
          {round.status === "active" && !challengeId && (
            <button onClick={startGame} className="text-xs text-gray-500 hover:text-white transition-colors">
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

      {/* Clue card */}
      <ClueCard round={round} friendName={friendName} />

      {/* Answer reveal */}
      {round.status !== "active" && round.targetHeaderImage && (
        <div className={`rounded-xl overflow-hidden border mb-4 ${round.status === "won" ? "border-green-700 bg-green-950" : "border-gray-700 bg-gray-900"}`}>
          <img src={round.targetHeaderImage} alt={round.targetTitle ?? ""} className="w-full object-cover" style={{ maxHeight: 180 }} />
          <div className="px-4 py-3">
            <p className="font-semibold text-white text-base">
              {round.status === "won" ? `Correct! It was ${round.targetTitle}` : `The answer was: ${round.targetTitle}`}
            </p>
          </div>
        </div>
      )}

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
                    {game.headerImage && <img src={game.headerImage} alt="" className="w-full h-full object-contain" />}
                  </div>
                  <span className="text-sm text-white">{game.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Guess history */}
      {round.guesses.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          {round.guesses.map((g) => (
            <div
              key={g.guessedAppId}
              className={`flex items-center gap-3 px-4 py-2 rounded-lg ${g.won ? "bg-green-900 border border-green-700" : "bg-gray-800"}`}
            >
              <div className="w-12 h-6 flex-shrink-0 rounded overflow-hidden bg-gray-900">
                {g.headerImage && <img src={g.headerImage} alt="" className="w-full h-full object-contain" />}
              </div>
              <span className="text-sm text-white flex-1">{g.title}</span>
              <span className={`text-base ${g.won ? "text-green-400" : "text-red-500"}`}>{g.won ? "✓" : "✗"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Post-round actions */}
      {round.status !== "active" && (
        <div className="flex flex-col gap-3">
          {challengeId ? (
            <a
              href={`/challenge/${challengeId}/results`}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors text-center text-base"
            >
              View Challenge Results
            </a>
          ) : (
            <>
              <button
                onClick={startGame}
                disabled={starting}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-base"
              >
                {friendName ? `Play Again — ${friendName}'s library` : "Play Again"}
              </button>
              <ChallengeLinkButton key={round.id} roundId={round.id} />
            </>
          )}
        </div>
      )}
    </main>
  );
}
