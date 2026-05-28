import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { syncUser } from "@/lib/steam/sync";
import { computeComparison } from "@/lib/game/compare";

const MAX_GUESSES = 8;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await syncUser(session.user.steamId, session.user.name ?? "");
  const body = await req.json();
  const guessedAppId: number = body.guessedAppId;

  if (typeof guessedAppId !== "number") {
    return NextResponse.json({ error: "Invalid guessedAppId" }, { status: 400 });
  }

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, status: "active" },
    include: { guesses: true, game: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ error: "No active round" }, { status: 404 });
  if (round.guesses.length >= MAX_GUESSES) {
    return NextResponse.json({ error: "Max guesses reached" }, { status: 400 });
  }
  if (round.guesses.some((g) => g.guessedAppId === guessedAppId)) {
    return NextResponse.json({ error: "Already guessed" }, { status: 400 });
  }

  const guessedGame = await db.game.findUnique({ where: { steamAppId: guessedAppId } });
  if (!guessedGame) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const comparison = computeComparison(guessedGame, round.game);

  await db.guess.create({
    data: { roundId: round.id, guessedAppId, resultJson: comparison as object },
  });

  const totalGuesses = round.guesses.length + 1;
  const won = comparison.won;
  const lost = !won && totalGuesses >= MAX_GUESSES;

  if (won || lost) {
    await db.round.update({
      where: { id: round.id },
      data: { status: won ? "won" : "lost" },
    });

    const currentStats = await db.stats.findUnique({ where: { userId: user.id } });
    const newStreak = won ? (currentStats?.currentStreak ?? 0) + 1 : 0;
    const newBestStreak = Math.max(currentStats?.bestStreak ?? 0, newStreak);

    await db.stats.upsert({
      where: { userId: user.id },
      update: {
        roundsPlayed: { increment: 1 },
        ...(won ? { roundsWon: { increment: 1 } } : {}),
        currentStreak: newStreak,
        bestStreak: newBestStreak,
      },
      create: {
        userId: user.id,
        roundsPlayed: 1,
        roundsWon: won ? 1 : 0,
        currentStreak: won ? 1 : 0,
        bestStreak: won ? 1 : 0,
      },
    });
  }

  return NextResponse.json({
    comparison,
    roundStatus: won ? "won" : lost ? "lost" : "active",
    ...(won || lost ? { targetTitle: round.game.title, targetHeaderImage: round.game.headerImage } : {}),
  });
}
