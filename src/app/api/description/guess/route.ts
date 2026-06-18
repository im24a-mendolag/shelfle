import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import type { InitRecord, GuessRecord, DescriptionRound } from "@/lib/description";
import { buildRound } from "@/lib/description";

const MAX_GUESSES = 3;

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
    where: { playerUserId: user.id, mode: "description", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true, target: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ error: "No active description round" }, { status: 404 });

  const all = round.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
  const init = all[0] as InitRecord;
  const realGuesses = all.slice(1) as GuessRecord[];

  if (realGuesses.length >= MAX_GUESSES) {
    return NextResponse.json({ error: "Max guesses reached" }, { status: 400 });
  }
  if (realGuesses.some((g) => g.guessedAppId === guessedAppId)) {
    return NextResponse.json({ error: "Already guessed" }, { status: 400 });
  }

  const guessedGame = await db.game.findUnique({ where: { steamAppId: guessedAppId } });
  if (!guessedGame) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const won = guessedAppId === round.targetAppId;
  const newGuess: GuessRecord = {
    type: "guess",
    guessedAppId,
    title: guessedGame.title,
    headerImage: guessedGame.headerImage,
    won,
  };

  await db.guess.create({
    data: { roundId: round.id, guessedAppId, resultJson: newGuess as object },
  });

  const updatedRealGuesses = [...realGuesses, newGuess];
  const lost = !won && updatedRealGuesses.length >= MAX_GUESSES;
  const newStatus = won ? "won" : lost ? "lost" : "active";

  if (won || lost) {
    await db.round.update({ where: { id: round.id }, data: { status: newStatus } });
  }

  const isFriend = round.targetUserId !== user.id;

  return NextResponse.json({
    round: buildRound(
      round.id,
      newStatus,
      init,
      updatedRealGuesses,
      round.game.title,
      round.game.headerImage,
      isFriend ? round.target.displayName : undefined,
    ) as DescriptionRound,
  });
}
