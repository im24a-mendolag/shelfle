import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [user, challenge] = await Promise.all([
    db.user.findUnique({ where: { steamId: session.user.steamId } }),
    db.challenge.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, displayName: true, steamId: true } },
        target: { select: { id: true, displayName: true } },
        game: { select: { steamAppId: true, title: true, headerImage: true } },
        rounds: {
          include: { guesses: { orderBy: { guessedAt: "asc" } }, player: { select: { id: true, displayName: true, steamId: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });

  const expired = challenge.expiresAt < new Date();
  const creatorRound = challenge.rounds.find((r) => r.playerUserId === challenge.creatorId);
  const opponentRound = challenge.rounds.find((r) => r.playerUserId !== challenge.creatorId);
  const currentUserRound = challenge.rounds.find((r) => r.playerUserId === user.id);
  const isCreator = user.id === challenge.creatorId;

  const serializeRound = (r: typeof creatorRound) => {
    if (!r) return null;
    const realGuesses = r.guesses.filter((g) => (g.resultJson as { type?: string }).type !== "init");
    let score: number | null = null;
    if (challenge.mode === "higherlower") {
      const lastGuess = r.guesses[r.guesses.length - 1];
      if (lastGuess) {
        const data = lastGuess.resultJson as { score?: number };
        score = data.score ?? null;
      }
    }
    return {
      playerId: r.playerUserId,
      playerName: r.player.displayName,
      playerSteamId: r.player.steamId,
      status: r.status,
      guessCount: realGuesses.length,
      score,
    };
  };

  return NextResponse.json({
    challenge: {
      id: challenge.id,
      mode: challenge.mode,
      status: challenge.status,
      expired,
      expiresAt: challenge.expiresAt,
      creatorName: challenge.creator.displayName,
      creatorId: challenge.creatorId,
      targetName: challenge.target.displayName,
      game: challenge.game ? { steamAppId: challenge.game.steamAppId, title: challenge.game.title, headerImage: challenge.game.headerImage } : null,
      isCreator,
      currentUserPlayed: !!currentUserRound,
      creatorRound: serializeRound(creatorRound),
      opponentRound: serializeRound(opponentRound),
    },
  });
}
