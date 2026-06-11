import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import type { InitRecord, GuessRecord, AchievementRound } from "../route";

const MAX_GUESSES = 5;

function buildRound(
  roundId: string,
  status: string,
  init: InitRecord,
  realGuesses: GuessRecord[],
  targetTitle: string,
  targetHeaderImage: string,
  friendName?: string,
): AchievementRound {
  const wrongCount = realGuesses.filter((g) => !g.won).length;
  const clueLevel: 0 | 1 | 2 | 3 = wrongCount >= 4 ? 3 : wrongCount >= 3 ? 2 : wrongCount >= 2 ? 1 : 0;
  const isOver = status === "won" || status === "lost";

  return {
    id: roundId,
    status: status as "active" | "won" | "lost",
    guesses: realGuesses.map((g) => ({
      guessedAppId: g.guessedAppId,
      title: g.title,
      headerImage: g.headerImage,
      won: g.won,
    })),
    maxGuesses: 5,
    clueLevel,
    achievementName: init.achievementName,
    achievementIconUrl: clueLevel >= 1 || isOver ? init.achievementIconUrl : undefined,
    achievementPercent: clueLevel >= 2 || isOver ? init.achievementPercent : undefined,
    achievementDescription: clueLevel >= 3 || isOver ? init.achievementDescription : undefined,
    targetTitle: isOver ? targetTitle : undefined,
    targetHeaderImage: isOver ? targetHeaderImage : undefined,
    friendName,
  };
}

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
    where: { playerUserId: user.id, mode: "achievement", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true, target: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ error: "No active achievement round" }, { status: 404 });

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
    ),
  });
}
