"use client";

import { useState, useEffect, useRef } from "react";

type DescriptionGuess = {
  guessedAppId: number;
  title: string;
  headerImage: string;
  won: boolean;
};

type DescriptionRound = {
  id: string;
  status: "active" | "won" | "lost";
  guesses: DescriptionGuess[];
  maxGuesses: 3;
  shortDescription: string;
  firstLetter?: string;
  releaseYear?: number;
  targetTitle?: string;
  targetHeaderImage?: string;
  friendName?: string;
  challengeId?: string;
};

type SearchGame = { steamAppId: number; title: string; headerImage: string };

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
      <p className="text-xs text-gray-500 text-center">{pct}%</p>
    </div>
  );
}

function DescriptionCard({ round }: { round: DescriptionRound }) {
  const wrongCount = round.guesses.filter((g) => !g.won).length;
  const isActive = round.status === "active";

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden mb-5">
      <div className="p-4 pb-3">
        <p className="text-gray-200 text-sm leading-relaxed italic">&ldquo;{round.shortDescription}&rdquo;</p>
      </div>

      <div className="px-4 pb-4 flex items-center gap-6">
        {/* First letter — revealed after 1 wrong guess */}
        <div className="flex flex-col items-center">
          <span className="text-xs text-gray-500 mb-1">Starts with</span>
          {round.firstLetter ? (
            <span className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-900 text-blue-200 text-xl font-bold">
              {round.firstLetter}
            </span>
          ) : (
            <span className="w-10 h-10 flex items-center justify-center rounded-lg bg-gray-800 text-gray-600 text-xl font-bold">
              ?
            </span>
          )}
        </div>

        {/* Release year — revealed after 2 wrong guesses */}
        <div className="flex flex-col items-center">
          <span className="text-xs text-gray-500 mb-1">Released</span>
          {round.releaseYear !== undefined ? (
            <span className="text-yellow-400 font-semibold">{round.releaseYear}</span>
          ) : (
            <span className="text-gray-600 font-semibold">????</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DescriptionClient({
  defaultFriend,
  defaultFriendName,
  defaultFriendAvatar,
  initialRound,
  challengeId,
}: {
  defaultFriend?: string;
  defaultFriendName?: string;
  defaultFriendAvatar?: string;
  initialRound?: DescriptionRound;
  challengeId?: string;
}) {
  const [round, setRound] = useState<DescriptionRound | null>(initialRound ?? null);
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
  const [challengeLink, setChallengeLink] = useState("");
  const [creatingChallenge, setCreatingChallenge] = useState(false);
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialRound) return;
    if (defaultFriend) {
      startGame();
      return;
    }
    fetch("/api/description")
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
          { delay: 700, pct: 65, label: "Picking a description…" },
        ];

    loadingTimers.current.forEach(clearTimeout);
    loadingTimers.current = [];
    setLoadingPct(stages[0].pct);
    setLoadingLabel(stages[0].label);
    stages.slice(1).forEach(({ delay, pct, label }) => {
      loadingTimers.current.push(setTimeout(() => { setLoadingPct(pct); setLoadingLabel(label); }, delay));
    });

    const body = defaultFriend ? { friendSteamId: defaultFriend } : {};
    const r = await fetch("/api/description", {
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

  async function createChallenge() {
    if (!round || creatingChallenge) return;
    setCreatingChallenge(true);
    const r = await fetch("/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId: round.id }),
    });
    const d = await r.json();
    if (d.challengeId) setChallengeLink(`${window.location.origin}/challenge/${d.challengeId}`);
    setCreatingChallenge(false);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(challengeLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function submitGuess(game: SearchGame) {
    if (!round || round.status !== "active" || submitting) return;
    setSubmitting(true);
    setQuery("");
    setResults([]);
    setDropdownOpen(false);

    const r = await fetch("/api/description/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guessedAppId: game.steamAppId }),
    });
    const d = await r.json();
    if (!d.error) {
      setRound(d.round);
    }
    setSubmitting(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const guessCount = round?.guesses.length ?? 0;
  const friendName = round?.friendName ?? friendDisplayName;

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      {!round || (loading && !starting) ? (
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
      ) : starting ? (
        <div className="flex flex-col items-center gap-4 py-20 max-w-sm mx-auto w-full">
          <LoadingBar pct={loadingPct} label={loadingLabel} />
        </div>
      ) : (
        <>
          {/* Header row: friend badge + guess dots */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {friendName && (
                <span className="flex items-center gap-1.5 text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
                  {friendAvatarUrl && <img src={friendAvatarUrl} alt="" className="w-4 h-4 rounded-full" />}
                  {friendName}&apos;s library
                </span>
              )}
              {round!.status !== "active" && (
                <span className="text-sm text-gray-400">
                  {round!.status === "won"
                    ? `Got it in ${guessCount} guess${guessCount === 1 ? "" : "es"}!`
                    : "Out of guesses"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {round!.status === "active" && (
                <button
                  onClick={() => startGame()}
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  New Game
                </button>
              )}
              <div className="flex gap-1">
                {Array.from({ length: round!.maxGuesses }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full ${
                      i < guessCount
                        ? round!.guesses[i].won ? "bg-green-500" : "bg-red-700"
                        : "bg-gray-700"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Description card */}
          <DescriptionCard round={round!} />

          {/* Answer reveal on game over */}
          {round!.status !== "active" && round!.targetHeaderImage && (
            <div className={`rounded-xl overflow-hidden border mb-4 ${round!.status === "won" ? "border-green-700 bg-green-950" : "border-gray-700 bg-gray-900"}`}>
              <img
                src={round!.targetHeaderImage}
                alt={round!.targetTitle ?? ""}
                className="w-full object-cover"
                style={{ maxHeight: 180 }}
              />
              <div className="px-4 py-3">
                <p className="font-semibold text-white text-base">
                  {round!.status === "won"
                    ? `Correct! It was ${round!.targetTitle}`
                    : `The answer was: ${round!.targetTitle}`}
                </p>
              </div>
            </div>
          )}

          {/* Search input */}
          {round!.status === "active" && (
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

          {/* Guess history */}
          {round!.guesses.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {round!.guesses.map((g) => (
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

          {/* Post-round actions */}
          {round!.status !== "active" && (
            <div className="flex flex-col gap-3">
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
                    onClick={startGame}
                    disabled={starting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-base"
                  >
                    {friendName ? `Play Again — ${friendName}'s library` : "Play Again"}
                  </button>
                  {!challengeLink ? (
                    <button
                      onClick={createChallenge}
                      disabled={creatingChallenge}
                      className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-base"
                    >
                      {creatingChallenge ? "Creating…" : "Challenge a Friend"}
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <input readOnly value={challengeLink} className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-300 truncate" />
                      <button onClick={copyLink} className="bg-gray-700 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-xl transition-colors text-sm shrink-0">
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
