import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";

type InitRecord = {
  type: "init";
  compareMode?: "year" | "price";
  leftAppId: number; leftTitle: string; leftImage: string; leftYear: number; leftPrice: number | null;
  rightAppId: number; rightTitle: string; rightImage: string; rightYear: number; rightPrice: number | null;
};

type GuessRecord = {
  type: "guess";
  leftAppId: number; leftTitle: string; leftImage: string; leftYear: number; leftPrice: number | null;
  rightAppId: number; rightTitle: string; rightImage: string; rightYear: number; rightPrice: number | null;
  playerAnswer: "higher" | "lower";
  outcome: "correct" | "wrong" | "tie";
  score: number;
  nextRightAppId?: number; nextRightTitle?: string; nextRightImage?: string; nextRightYear?: number; nextRightPrice?: number | null;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user, body] = await Promise.all([
    db.user.findUnique({ where: { steamId: session.user.steamId } }),
    req.json(),
  ]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const playerAnswer: "higher" | "lower" = body.answer;
  if (playerAnswer !== "higher" && playerAnswer !== "lower") {
    return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
  }

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, mode: "higherlower", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ error: "No active round" }, { status: 404 });

  const all = round.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
  const init = all[0] as InitRecord;
  const realGuesses = all.slice(1) as GuessRecord[];
  const last = realGuesses[realGuesses.length - 1];

  const compareMode: "year" | "price" = init.compareMode ?? "year";

  let leftAppId: number, leftTitle: string, leftImage: string, leftYear: number, leftPrice: number | null;
  let rightAppId: number, rightTitle: string, rightImage: string, rightYear: number, rightPrice: number | null;
  let currentScore: number;

  if (!last) {
    ({ leftAppId, leftTitle, leftImage, leftYear, leftPrice, rightAppId, rightTitle, rightImage, rightYear, rightPrice } = {
      ...init,
      leftPrice: init.leftPrice ?? null,
      rightPrice: init.rightPrice ?? null,
    });
    currentScore = 0;
  } else {
    leftAppId = last.rightAppId; leftTitle = last.rightTitle; leftImage = last.rightImage; leftYear = last.rightYear; leftPrice = last.rightPrice ?? null;
    rightAppId = last.nextRightAppId!; rightTitle = last.nextRightTitle!; rightImage = last.nextRightImage!; rightYear = last.nextRightYear!; rightPrice = last.nextRightPrice ?? null;
    currentScore = last.score;
  }

  let outcome: "correct" | "wrong" | "tie";

  if (compareMode === "price") {
    if (leftPrice === null || rightPrice === null) {
      outcome = "tie";
    } else if (rightPrice === leftPrice) {
      outcome = "tie";
    } else {
      outcome = (playerAnswer === "higher") === (rightPrice > leftPrice) ? "correct" : "wrong";
    }
  } else {
    if (rightYear === leftYear) {
      outcome = "tie";
    } else {
      outcome = (playerAnswer === "higher") === (rightYear > leftYear) ? "correct" : "wrong";
    }
  }

  const newScore = outcome === "correct" ? currentScore + 1 : currentScore;

  let nextGame: { steamAppId: number; title: string; headerImage: string; releaseYear: number; priceChfCents: number | null } | null = null;

  if (outcome !== "wrong") {
    const shownIds = new Set<number>([init.leftAppId, init.rightAppId]);
    realGuesses.forEach((g) => {
      shownIds.add(g.rightAppId);
      if (g.nextRightAppId) shownIds.add(g.nextRightAppId);
    });
    shownIds.add(rightAppId);

    const pool = await db.userGame.findMany({
      where: { userId: round.targetUserId },
      include: {
        game: {
          select: { steamAppId: true, title: true, headerImage: true, tags: true, releaseYear: true, reviewPct: true, priceChfCents: true },
        },
      },
    });

    const isEligible = (ug: typeof pool[0]) =>
      ug.game.headerImage !== "" &&
      ug.game.tags.length > 0 &&
      ug.game.releaseYear !== null &&
      ug.game.reviewPct !== null &&
      (compareMode !== "price" || (ug.game.priceChfCents !== null && ug.game.priceChfCents > 0));

    const eligible = pool.filter((ug) => !shownIds.has(ug.game.steamAppId) && isEligible(ug));
    const candidates = eligible.length > 0
      ? eligible
      : pool.filter((ug) => ug.game.steamAppId !== rightAppId && isEligible(ug));

    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      nextGame = {
        steamAppId: pick.game.steamAppId,
        title: pick.game.title,
        headerImage: pick.game.headerImage,
        releaseYear: pick.game.releaseYear as number,
        priceChfCents: pick.game.priceChfCents,
      };
    }
  }

  const resultJson: GuessRecord = {
    type: "guess",
    leftAppId, leftTitle, leftImage, leftYear, leftPrice,
    rightAppId, rightTitle, rightImage, rightYear, rightPrice,
    playerAnswer,
    outcome,
    score: newScore,
    ...(nextGame
      ? { nextRightAppId: nextGame.steamAppId, nextRightTitle: nextGame.title, nextRightImage: nextGame.headerImage, nextRightYear: nextGame.releaseYear, nextRightPrice: nextGame.priceChfCents }
      : {}),
  };

  await db.guess.create({
    data: { roundId: round.id, guessedAppId: rightAppId, resultJson: resultJson as object },
  });

  if (outcome === "wrong") {
    await db.round.update({ where: { id: round.id }, data: { status: "lost" } });
  }

  return NextResponse.json({
    outcome,
    rightYear,
    rightPrice,
    score: newScore,
    roundStatus: outcome === "wrong" ? "lost" : "active",
    ...(outcome !== "wrong" && nextGame
      ? {
          nextGame: { steamAppId: nextGame.steamAppId, title: nextGame.title, headerImage: nextGame.headerImage },
          newLeft: { steamAppId: rightAppId, title: rightTitle, headerImage: rightImage, releaseYear: rightYear, priceChfCents: rightPrice },
        }
      : {}),
  });
}
