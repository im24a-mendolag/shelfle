import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser } from "@/lib/steam/sync";
import { db } from "@/lib/db";
import { CopyLinkRow } from "@/components/challenge/ChallengeActions";

const MODE_LABELS: Record<string, string> = {
  solo: "Classic",
  friend: "Classic",
  zoom: "Zoom",
  achievement: "Achievement",
  description: "Description",
  higherlower: "Higher/Lower",
};

const MODE_PATHS: Record<string, string> = {
  solo: "/play",
  friend: "/play",
  zoom: "/zoom",
  achievement: "/achievement",
  description: "/description",
  higherlower: "/higherlower",
};

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) redirect("/");

  const user = await syncUser(session.user.steamId, session.user.name ?? "");

  const challenge = await db.challenge.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, displayName: true } },
      target: { select: { displayName: true } },
      game: { select: { title: true, headerImage: true } },
      rounds: { select: { playerUserId: true, status: true } },
    },
  });

  if (!challenge) redirect("/");

  const expired = challenge.expiresAt < new Date();
  const isCreator = user.id === challenge.creatorId;
  const currentUserRound = challenge.rounds.find((r) => r.playerUserId === user.id);
  const opponentRound = challenge.rounds.find((r) => r.playerUserId !== challenge.creatorId);

  // Opponent already finished → go straight to results
  if (!isCreator && currentUserRound) redirect(`/challenge/${id}/results`);

  const modeLabel = MODE_LABELS[challenge.mode] ?? challenge.mode;
  const playPath = `${MODE_PATHS[challenge.mode] ?? "/play"}?challenge=${id}`;
  const challengeUrl = `${process.env.NEXTAUTH_URL ?? "https://shelfle.vercel.app"}/challenge/${id}`;

  return (
    <main className="max-w-lg mx-auto px-4 py-16 flex flex-col items-center gap-6">
      <span className="text-xs font-semibold uppercase tracking-widest text-blue-400 bg-blue-950 px-3 py-1 rounded-full">
        {modeLabel} Challenge
      </span>

      <h1 className="text-2xl font-bold text-white text-center">
        {isCreator
          ? "Share this challenge with a friend"
          : `${challenge.creator.displayName} challenged you!`}
      </h1>

      {isCreator ? (
        <>
          {challenge.game && (
            <div className="w-full rounded-xl overflow-hidden bg-gray-900 border border-gray-800">
              <img src={challenge.game.headerImage} alt={challenge.game.title} className="w-full object-cover" style={{ maxHeight: 180 }} />
              <p className="text-center text-sm text-gray-400 py-2 px-3">{challenge.game.title}</p>
            </div>
          )}
          <p className="text-sm text-gray-400 text-center">
            {opponentRound
              ? "Your friend has played — check the results!"
              : "Send this link to a friend so they can play the same game."}
          </p>
          {!opponentRound && <CopyLinkRow url={challengeUrl} />}
          {opponentRound && (
            <a
              href={`/challenge/${id}/results`}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors text-center text-base"
            >
              View Results
            </a>
          )}
          <a
            href="/"
            className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold py-3 rounded-xl transition-colors text-center text-base"
          >
            Back to Home
          </a>
        </>
      ) : expired ? (
        <>
          <p className="text-red-400 text-sm text-center">This challenge has expired.</p>
          <a href="/" className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold py-3 rounded-xl transition-colors text-center">
            Back to Home
          </a>
        </>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 w-full text-center">
            <p className="text-gray-400 text-sm">
              Play <span className="text-white font-semibold">{modeLabel}</span> mode from{" "}
              <span className="text-white font-semibold">{challenge.target.displayName}&apos;s</span> library.
              Can you beat {challenge.creator.displayName}&apos;s score?
            </p>
          </div>
          <a
            href={playPath}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-colors text-center text-lg"
          >
            Accept Challenge
          </a>
        </>
      )}
    </main>
  );
}
