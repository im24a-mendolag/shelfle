import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { CHALLENGE_MODE_LABELS } from "@/lib/gameModes";

type RoundSummary = {
  playerName: string;
  status: string;
  guessCount: number;
  score: number | null;
};

function getScore(mode: string, round: { guesses: { resultJson: unknown }[] }): number | null {
  if (mode !== "higherlower") return null;
  const realGuesses = round.guesses.filter((g) => (g.resultJson as { type?: string }).type === "guess");
  if (realGuesses.length === 0) return 0;
  const last = realGuesses[realGuesses.length - 1].resultJson as { score?: number };
  return last.score ?? 0;
}

function determineWinner(mode: string, a: RoundSummary, b: RoundSummary): "a" | "b" | "tie" | null {
  if (mode === "higherlower") {
    if (a.score === null || b.score === null) return null;
    if (a.score > b.score) return "a";
    if (b.score > a.score) return "b";
    return "tie";
  }
  if (a.status === "won" && b.status !== "won") return "a";
  if (b.status === "won" && a.status !== "won") return "b";
  if (a.status === "won" && b.status === "won") {
    if (a.guessCount < b.guessCount) return "a";
    if (b.guessCount < a.guessCount) return "b";
    return "tie";
  }
  return "tie";
}

function PlayerCard({ summary, isWinner, isCurrentUser, isHigherLower }: { summary: RoundSummary; isWinner: boolean; isCurrentUser: boolean; isHigherLower: boolean }) {
  const statusText = isHigherLower
    ? `Score: ${summary.score ?? 0}`
    : summary.status === "won"
      ? `Won in ${summary.guessCount} guess${summary.guessCount === 1 ? "" : "es"}`
      : `Lost (${summary.guessCount} guess${summary.guessCount === 1 ? "" : "es"})`;

  return (
    <div
      className={`flex-1 rounded-xl border p-5 text-center flex flex-col gap-2 ${
        isWinner ? "border-green-600 bg-green-950" : "border-gray-700 bg-gray-900"
      }`}
    >
      {isWinner && <span className="text-xs font-bold uppercase tracking-widest text-green-400">Winner</span>}
      <p className="text-white font-semibold text-lg">
        {summary.playerName}
        {isCurrentUser && <span className="text-xs text-gray-400 ml-1">(you)</span>}
      </p>
      <p className={`text-sm font-medium ${summary.status === "won" || isHigherLower ? "text-green-400" : "text-red-400"}`}>
        {statusText}
      </p>
    </div>
  );
}

export default async function ChallengeResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) redirect("/");

  const [user, challenge] = await Promise.all([
    db.user.findUnique({ where: { steamId: session.user.steamId }, select: { id: true } }),
    db.challenge.findUnique({
      where: { id },
      include: {
        game: { select: { title: true, headerImage: true } },
        rounds: {
          include: {
            guesses: { orderBy: { guessedAt: "asc" } },
            player: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);

  if (!user || !challenge) redirect("/");

  const creatorRound = challenge.rounds.find((r) => r.playerUserId === challenge.creatorId);
  const opponentRound = challenge.rounds.find((r) => r.playerUserId !== challenge.creatorId);

  if (!creatorRound && !opponentRound) redirect(`/challenge/${id}`);

  const modeLabel = CHALLENGE_MODE_LABELS[challenge.mode] ?? challenge.mode;
  const isHigherLower = challenge.mode === "higherlower";

  const toSummary = (round: typeof creatorRound): RoundSummary | null => {
    if (!round) return null;
    const realGuesses = round.guesses.filter((g) => (g.resultJson as { type?: string }).type !== "init");
    return {
      playerName: round.player.displayName,
      status: round.status,
      guessCount: realGuesses.length,
      score: getScore(challenge.mode, round),
    };
  };

  const creatorSummary = toSummary(creatorRound);
  const opponentSummary = toSummary(opponentRound);

  const winner = creatorSummary && opponentSummary
    ? determineWinner(challenge.mode, creatorSummary, opponentSummary)
    : null;

  const waitingForOpponent = !!creatorRound && !opponentRound;
  const waitingForCreator = !creatorRound && !!opponentRound;

  return (
    <main className="max-w-xl mx-auto px-4 py-12 flex flex-col gap-6">
      <div className="text-center flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-blue-400 bg-blue-950 px-3 py-1 rounded-full self-center">
          {modeLabel} Challenge
        </span>
        {challenge.game && (
          <div className="w-full rounded-xl overflow-hidden bg-gray-900 border border-gray-800 mt-2">
            <img src={challenge.game.headerImage} alt={challenge.game.title} className="w-full object-cover" style={{ maxHeight: 180 }} />
            <p className="text-sm text-gray-400 py-2 px-3">{challenge.game.title}</p>
          </div>
        )}
        {!challenge.game && isHigherLower && (
          <p className="text-sm text-gray-500 mt-1">Highest score wins</p>
        )}
      </div>

      {winner === "tie" && (
        <div className="bg-yellow-950 border border-yellow-700 rounded-xl p-4 text-center">
          <p className="text-yellow-400 font-semibold text-lg">It&apos;s a tie!</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        {creatorSummary ? (
          <PlayerCard summary={creatorSummary} isWinner={winner === "a"} isCurrentUser={user.id === challenge.creatorId} isHigherLower={isHigherLower} />
        ) : (
          <div className="flex-1 rounded-xl border border-gray-700 bg-gray-900 p-5 text-center">
            <p className="text-gray-500 text-sm">Waiting for challenger…</p>
          </div>
        )}

        <div className="flex items-center justify-center text-gray-600 font-bold text-xl sm:self-center">vs</div>

        {opponentSummary ? (
          <PlayerCard summary={opponentSummary} isWinner={winner === "b"} isCurrentUser={user.id !== challenge.creatorId} isHigherLower={isHigherLower} />
        ) : (
          <div className="flex-1 rounded-xl border border-gray-700 bg-gray-900 p-5 text-center">
            <p className="text-gray-500 text-sm">Waiting for opponent…</p>
          </div>
        )}
      </div>

      {waitingForOpponent && (
        <p className="text-gray-400 text-sm text-center">
          Your friend hasn&apos;t played yet. Share the link so they can compete!
        </p>
      )}
      {waitingForCreator && (
        <p className="text-gray-400 text-sm text-center">
          Waiting for the challenger&apos;s result…
        </p>
      )}

      <div className="flex flex-col gap-3 mt-2">
        <a href="/" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors text-center">
          Back to Home
        </a>
      </div>
    </main>
  );
}
