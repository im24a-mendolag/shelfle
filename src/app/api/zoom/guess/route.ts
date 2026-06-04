import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
const MAX_GUESSES = 6;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user, body] = await Promise.all([
    db.user.findUnique({ where: { steamId: session.user.steamId } }),
    req.json(),
  ]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const guessedAppId: number = body.guessedAppId;

  if (typeof guessedAppId !== "number") {
    return NextResponse.json({ error: "Invalid guessedAppId" }, { status: 400 });
  }

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, mode: "zoom", status: "active" },
    include: { guesses: true, game: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ error: "No active zoom round" }, { status: 404 });
  if (round.guesses.length >= MAX_GUESSES) {
    return NextResponse.json({ error: "Max guesses reached" }, { status: 400 });
  }
  if (round.guesses.some((g) => g.guessedAppId === guessedAppId)) {
    return NextResponse.json({ error: "Already guessed" }, { status: 400 });
  }

  const guessedGame = await db.game.findUnique({ where: { steamAppId: guessedAppId } });
  if (!guessedGame) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const won = guessedAppId === round.targetAppId;
  const resultJson = {
    guessedAppId,
    title: guessedGame.title,
    headerImage: guessedGame.headerImage,
    won,
  };

  await db.guess.create({
    data: { roundId: round.id, guessedAppId, resultJson: resultJson as object },
  });

  const totalGuesses = round.guesses.length + 1;
  const lost = !won && totalGuesses >= MAX_GUESSES;

  if (won || lost) {
    await db.round.update({
      where: { id: round.id },
      data: { status: won ? "won" : "lost" },
    });
  }

  return NextResponse.json({
    guess: resultJson,
    roundStatus: won ? "won" : lost ? "lost" : "active",
    ...(won || lost ? { targetTitle: round.game.title, targetHeaderImage: round.game.headerImage } : {}),
  });
}
