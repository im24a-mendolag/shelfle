import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { buildRound, MAX_GUESSES } from "@/lib/playtime";
import type { InitRecord, GuessRecord } from "@/app/api/playtime/route";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user, body] = await Promise.all([
    db.user.findUnique({ where: { steamId: session.user.steamId } }),
    req.json(),
  ]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const guessedAppId: number = body.guessedAppId;
  if (typeof guessedAppId !== "number") return NextResponse.json({ error: "Invalid guessedAppId" }, { status: 400 });

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, mode: "playtime", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ error: "No active round" }, { status: 404 });

  const all = round.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
  const init = all[0] as InitRecord;
  const realGuesses = all.slice(1) as GuessRecord[];

  if (realGuesses.length >= MAX_GUESSES) return NextResponse.json({ error: "Max guesses reached" }, { status: 400 });
  if (realGuesses.some((g) => g.guessedAppId === guessedAppId)) return NextResponse.json({ error: "Already guessed" }, { status: 400 });

  const guessedGame = await db.game.findUnique({ where: { steamAppId: guessedAppId } });
  if (!guessedGame) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const won = guessedAppId === round.targetAppId;
  const guessRecord: GuessRecord = {
    type: "guess",
    guessedAppId,
    title: guessedGame.title,
    headerImage: guessedGame.headerImage,
    won,
  };

  const newRealGuesses = [...realGuesses, guessRecord];
  const lost = !won && newRealGuesses.length >= MAX_GUESSES;

  await Promise.all([
    db.guess.create({ data: { roundId: round.id, guessedAppId, resultJson: guessRecord as object } }),
    won || lost
      ? db.round.update({ where: { id: round.id }, data: { status: won ? "won" : "lost" } })
      : Promise.resolve(),
  ]);

  return NextResponse.json({
    round: buildRound(
      round.id,
      won ? "won" : lost ? "lost" : "active",
      init,
      newRealGuesses,
      round.game.title,
      round.game.headerImage,
    ),
  });
}
