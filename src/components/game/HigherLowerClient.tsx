"use client";

import { useState, useEffect, useRef } from "react";

type HLGame = { steamAppId: number; title: string; headerImage: string; releaseYear: number; priceChfCents: number | null; avgPlayers24h: number | null };
type HLRightGame = { steamAppId: number; title: string; headerImage: string };

type HLRound = {
  id: string;
  status: "active" | "lost";
  score: number;
  compareMode: "year" | "price" | "players";
  leftGame: HLGame;
  rightGame: HLRightGame;
  friendName?: string;
};

type Phase = "loading" | "guessing" | "revealing" | "lost";

function formatPlayers(v: number | null | undefined): string {
  if (v === undefined) return "???";
  if (v === null) return "No data";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}

function formatValue(mode: "year" | "price" | "players", year: number, price: number | null | undefined, players: number | null | undefined): string {
  if (mode === "year") return String(year);
  if (mode === "players") return formatPlayers(players);
  if (price === undefined) return "???";
  if (price === null) return "No data";
  if (price === 0) return "Free";
  return `CHF ${(price / 100).toFixed(2)}`;
}

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

function GameCard({
  game,
  valueLabel,
  highlight,
}: {
  game: { title: string; headerImage: string };
  valueLabel: string;
  highlight?: "correct" | "wrong" | "tie" | null;
}) {
  const borderColor =
    highlight === "correct"
      ? "border-green-500"
      : highlight === "tie"
        ? "border-yellow-500"
        : highlight === "wrong"
          ? "border-red-600"
          : "border-gray-800";

  const valueColor =
    valueLabel === "???"
      ? "text-gray-500"
      : highlight === "correct"
        ? "text-green-400"
        : highlight === "tie"
          ? "text-yellow-400"
          : highlight === "wrong"
            ? "text-red-400"
            : "text-blue-400";

  return (
    <div className={`flex-1 w-full bg-gray-900 rounded-xl overflow-hidden border-2 ${borderColor} transition-colors duration-300`}>
      <div style={{ aspectRatio: "460/215" }}>
        {game.headerImage ? (
          <img src={game.headerImage} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-800 text-gray-600 text-sm">
            No image
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-white font-medium text-sm leading-snug line-clamp-2">{game.title}</p>
        <p className={`text-xl font-bold mt-1 ${valueColor} transition-colors duration-300`}>{valueLabel}</p>
      </div>
    </div>
  );
}

export default function HigherLowerClient({
  defaultFriend,
  defaultFriendName,
  defaultFriendAvatar,
  initialRound,
}: {
  defaultFriend?: string;
  defaultFriendName?: string;
  defaultFriendAvatar?: string;
  initialRound?: HLRound;
}) {
  const [phase, setPhase] = useState<Phase>(initialRound ? (initialRound.status === "lost" ? "lost" : "guessing") : "loading");
  const [round, setRound] = useState<HLRound | null>(initialRound ?? null);
  const [compareMode, setCompareMode] = useState<"year" | "price" | "players">(initialRound?.compareMode ?? "year");
  const [startError, setStartError] = useState("");
  const [loadingPct, setLoadingPct] = useState(15);
  const [loadingLabel, setLoadingLabel] = useState("Loading…");
  const [friendDisplayName, setFriendDisplayName] = useState(defaultFriendName ?? "");
  const [friendAvatarUrl] = useState(defaultFriendAvatar ?? "");

  const [revealedYear, setRevealedYear] = useState<number | null>(null);
  const [revealedPrice, setRevealedPrice] = useState<number | null | undefined>(undefined);
  const [revealedPlayers, setRevealedPlayers] = useState<number | null | undefined>(undefined);
  const [revealOutcome, setRevealOutcome] = useState<"correct" | "wrong" | "tie" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initialRound) return;
    if (defaultFriend) {
      startGame();
      return;
    }
    fetch("/api/higherlower")
      .then((r) => r.json())
      .then((d) => {
        if (d.round && !d.round.friendName) {
          setRound(d.round);
          setCompareMode(d.round.compareMode ?? "year");
          setPhase(d.round.status === "lost" ? "lost" : "guessing");
        } else {
          startGame();
        }
      })
      .catch(() => startGame());
  }, []);

  async function startGame() {
    setPhase("loading");
    setStartError("");
    setRevealedYear(null);
    setRevealedPrice(undefined);
    setRevealedPlayers(undefined);
    setRevealOutcome(null);

    const isFriend = !!defaultFriend;
    const stages = isFriend
      ? [
          { delay: 0, pct: 8, label: "Resolving Steam profile…" },
          { delay: 2000, pct: 28, label: "Syncing friend's profile…" },
          { delay: 5000, pct: 52, label: "Importing library…" },
          { delay: 11000, pct: 72, label: "Fetching game data…" },
          { delay: 19000, pct: 88, label: "Almost there…" },
        ]
      : [
          { delay: 0, pct: 25, label: "Loading your library…" },
          { delay: 700, pct: 65, label: "Picking games…" },
        ];

    loadingTimers.current.forEach(clearTimeout);
    loadingTimers.current = [];
    setLoadingPct(stages[0].pct);
    setLoadingLabel(stages[0].label);
    stages.slice(1).forEach(({ delay, pct, label }) => {
      loadingTimers.current.push(setTimeout(() => { setLoadingPct(pct); setLoadingLabel(label); }, delay));
    });

    const body = defaultFriend ? { friendSteamId: defaultFriend, compareMode } : { compareMode };
    const r = await fetch("/api/higherlower", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    loadingTimers.current.forEach(clearTimeout);
    loadingTimers.current = [];

    const d = await r.json();
    if (d.error) {
      setStartError(d.error);
      setPhase("loading");
      return;
    }

    setLoadingPct(100);
    setLoadingLabel("Let's go!");
    if (d.round.friendName) setFriendDisplayName(d.round.friendName);

    setTimeout(() => {
      setRound(d.round);
      setPhase("guessing");
    }, 450);
  }

  async function submitGuess(answer: "higher" | "lower") {
    if (!round || phase !== "guessing" || submitting) return;
    setSubmitting(true);

    const r = await fetch("/api/higherlower/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    const d = await r.json();
    if (d.error) {
      setSubmitting(false);
      return;
    }

    setRevealedYear(d.rightYear);
    setRevealedPrice(d.rightPrice ?? null);
    setRevealedPlayers(d.rightPlayers ?? null);
    setRevealOutcome(d.outcome);
    setPhase("revealing");
    setSubmitting(false);

    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      if (d.roundStatus === "lost") {
        setRound((prev) => prev ? { ...prev, status: "lost" } : prev);
        setPhase("lost");
      } else {
        setRound((prev) =>
          prev && d.newLeft && d.nextGame
            ? { ...prev, score: d.score, leftGame: d.newLeft, rightGame: d.nextGame }
            : prev,
        );
        setRevealedYear(null);
        setRevealedPrice(undefined);
        setRevealedPlayers(undefined);
        setRevealOutcome(null);
        setPhase("guessing");
      }
    }, 1400);
  }

  const friendName = round?.friendName ?? friendDisplayName;
  const isRevealing = phase === "revealing";
  const activeMode = round?.compareMode ?? compareMode;

  function leftLabel(): string {
    if (!round) return "???";
    return formatValue(activeMode, round.leftGame.releaseYear, round.leftGame.priceChfCents, round.leftGame.avgPlayers24h);
  }

  function rightLabel(): string {
    if (revealedYear === null || (phase !== "revealing" && phase !== "lost")) return "???";
    return formatValue(activeMode, revealedYear, revealedPrice, revealedPlayers);
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      {phase === "loading" ? (
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
      ) : round ? (
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              {friendName && (
                <span className="flex items-center gap-1.5 text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
                  {friendAvatarUrl && <img src={friendAvatarUrl} alt="" className="w-4 h-4 rounded-full" />}
                  {friendName}&apos;s library
                </span>
              )}
              {/* Mode toggle */}
              <div className="flex rounded-lg overflow-hidden border border-gray-700">
                <button
                  onClick={() => setCompareMode("year")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    compareMode === "year" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  Year
                </button>
                <button
                  onClick={() => setCompareMode("price")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    compareMode === "price" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  Price
                </button>
                <button
                  onClick={() => setCompareMode("players")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    compareMode === "players" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  Players
                </button>
              </div>
              {compareMode !== activeMode && phase !== "lost" && (
                <span className="text-xs text-gray-500">takes effect on New Game</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold text-white tabular-nums">{round.score}</span>
              {(phase === "guessing" || phase === "revealing") && (
                <button
                  onClick={() => startGame()}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  New Game
                </button>
              )}
            </div>
          </div>

          {/* Game cards */}
          <div className="flex flex-col sm:flex-row gap-4 items-stretch">
            <GameCard game={round.leftGame} valueLabel={leftLabel()} />

            {/* Center controls */}
            <div className="flex sm:flex-col justify-center items-center gap-3 py-2 sm:py-0 sm:min-w-[80px]">
              {isRevealing ? (
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={`text-3xl font-black ${
                      revealOutcome === "correct"
                        ? "text-green-400"
                        : revealOutcome === "tie"
                          ? "text-yellow-400"
                          : "text-red-400"
                    }`}
                  >
                    {revealOutcome === "correct" ? "✓" : revealOutcome === "tie" ? "=" : "✗"}
                  </span>
                  <span className="text-xs text-gray-400 text-center">
                    {revealOutcome === "correct" ? "Correct!" : revealOutcome === "tie" ? "Pass" : "Wrong!"}
                  </span>
                </div>
              ) : phase === "guessing" ? (
                <>
                  <button
                    onClick={() => submitGuess("higher")}
                    disabled={submitting}
                    className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm flex items-center gap-1.5"
                  >
                    <span>Higher</span><span className="text-base">↑</span>
                  </button>
                  <button
                    onClick={() => submitGuess("lower")}
                    disabled={submitting}
                    className="w-full sm:w-auto px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm flex items-center gap-1.5"
                  >
                    <span>Lower</span><span className="text-base">↓</span>
                  </button>
                </>
              ) : null}
            </div>

            <GameCard
              game={round.rightGame}
              valueLabel={rightLabel()}
              highlight={isRevealing ? revealOutcome : null}
            />
          </div>

          {/* Game over */}
          {phase === "lost" && (
            <div className="mt-6 bg-gray-800 border border-gray-700 rounded-xl p-5 text-center">
              <p className="text-lg font-semibold text-white mb-1">Game over!</p>
              <p className="text-gray-400 text-sm mb-4">
                Final score: <span className="text-white font-bold text-xl">{round.score}</span>
              </p>
              <button
                onClick={() => startGame()}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors"
              >
                {friendName ? `Play Again — ${friendName}'s library` : "Play Again"}
              </button>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
