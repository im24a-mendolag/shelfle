import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";

type HLGame = { steamAppId: number; title: string; headerImage: string; releaseYear: number; priceChfCents: number | null; avgPlayers24h: number | null };

type InitRecord = {
  type: "init";
  compareMode?: "year" | "price" | "players";
  leftAppId: number; leftTitle: string; leftImage: string; leftYear: number; leftPrice: number | null; leftPlayers: number | null;
  rightAppId: number; rightTitle: string; rightImage: string; rightYear: number; rightPrice: number | null; rightPlayers: number | null;
};

type GuessRecord = {
  type: "guess";
  rightAppId: number; rightTitle: string; rightImage: string; rightYear: number; rightPrice: number | null; rightPlayers: number | null;
  nextRightAppId?: number; nextRightTitle?: string; nextRightImage?: string; nextRightYear?: number; nextRightPrice?: number | null; nextRightPlayers?: number | null;
  outcome: "correct" | "wrong" | "tie";
  score: number;
};

async function pickPool(userId: string, compareMode: "year" | "price" | "players"): Promise<HLGame[]> {
  const rows = await db.userGame.findMany({
    where: { userId },
    include: {
      game: {
        select: { steamAppId: true, title: true, headerImage: true, tags: true, releaseYear: true, reviewPct: true, priceChfCents: true, avgPlayers24h: true },
      },
    },
  });
  return rows
    .filter(
      (ug) =>
        ug.game.headerImage !== "" &&
        ug.game.tags.length > 0 &&
        ug.game.releaseYear !== null &&
        ug.game.reviewPct !== null &&
        (compareMode !== "price" || (ug.game.priceChfCents !== null && ug.game.priceChfCents > 0)) &&
        (compareMode !== "players" || (ug.game.avgPlayers24h !== null && ug.game.avgPlayers24h > 0)),
    )
    .map((ug) => ({
      steamAppId: ug.game.steamAppId,
      title: ug.game.title,
      headerImage: ug.game.headerImage,
      releaseYear: ug.game.releaseYear as number,
      priceChfCents: ug.game.priceChfCents,
      avgPlayers24h: ug.game.avgPlayers24h,
    }));
}

function pickFrom(pool: HLGame[], exclude: Set<number>): HLGame | null {
  const eligible = pool.filter((g) => !exclude.has(g.steamAppId));
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

export async function GET() {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { steamId: session.user.steamId } });
  if (!user) return NextResponse.json({ round: null });

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, mode: "higherlower", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, target: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ round: null });

  const all = round.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
  const init = all[0] as InitRecord;
  const realGuesses = all.slice(1) as GuessRecord[];
  const last = realGuesses[realGuesses.length - 1];

  const compareMode: "year" | "price" | "players" = init.compareMode ?? "year";

  let leftGame: HLGame;
  let rightGame: Omit<HLGame, "releaseYear" | "priceChfCents">;
  let score: number;

  if (!last) {
    leftGame = { steamAppId: init.leftAppId, title: init.leftTitle, headerImage: init.leftImage, releaseYear: init.leftYear, priceChfCents: init.leftPrice ?? null, avgPlayers24h: init.leftPlayers ?? null };
    rightGame = { steamAppId: init.rightAppId, title: init.rightTitle, headerImage: init.rightImage };
    score = 0;
  } else {
    leftGame = { steamAppId: last.rightAppId, title: last.rightTitle, headerImage: last.rightImage, releaseYear: last.rightYear, priceChfCents: last.rightPrice ?? null, avgPlayers24h: last.rightPlayers ?? null };
    rightGame = { steamAppId: last.nextRightAppId!, title: last.nextRightTitle!, headerImage: last.nextRightImage! };
    score = last.score;
  }

  const isFriend = round.targetUserId !== user.id;

  return NextResponse.json({
    round: {
      id: round.id,
      status: round.status,
      score,
      compareMode,
      leftGame,
      rightGame,
      friendName: isFriend ? round.target.displayName : undefined,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await syncUser(session.user.steamId, session.user.name ?? "");

  await db.round.updateMany({
    where: { playerUserId: user.id, status: "active" },
    data: { status: "abandoned" },
  });

  const body = await req.json().catch(() => ({}));
  const friendInput: string | undefined = body.friendSteamId;
  const compareMode: "year" | "price" | "players" = body.compareMode === "price" ? "price" : body.compareMode === "players" ? "players" : "year";
  let targetUser = user;

  if (friendInput) {
    const friendSteamId = await resolveSteamId(friendInput);
    if (!friendSteamId) {
      return NextResponse.json(
        { error: "Could not resolve Steam ID. Try a 17-digit Steam ID, profile URL, or vanity name." },
        { status: 400 },
      );
    }
    if (friendSteamId === session.user.steamId) {
      return NextResponse.json({ error: "That's your own profile — use Solo mode." }, { status: 400 });
    }
    const { displayName } = await getSteamProfile(friendSteamId);
    targetUser = await syncUser(friendSteamId, displayName);
    try {
      await syncLibrary(targetUser.id, friendSteamId);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to sync friend's library. Their profile may be private." },
        { status: 400 },
      );
    }
    revalidateTag("game-search");
    revalidateTag("library");
  }

  const pool = await pickPool(targetUser.id, compareMode);
  if (pool.length < 2) {
    return NextResponse.json(
      { error: friendInput ? "Friend's library has no enriched games yet." : "No enriched games found. Visit your library page first." },
      { status: 400 },
    );
  }

  const leftGame = pool[Math.floor(Math.random() * pool.length)];
  const rightGame = pickFrom(pool, new Set([leftGame.steamAppId]))!;

  const round = await db.round.create({
    data: {
      playerUserId: user.id,
      targetUserId: targetUser.id,
      targetAppId: leftGame.steamAppId,
      mode: "higherlower",
      status: "active",
    },
  });

  const init: InitRecord = {
    type: "init",
    compareMode,
    leftAppId: leftGame.steamAppId, leftTitle: leftGame.title, leftImage: leftGame.headerImage, leftYear: leftGame.releaseYear, leftPrice: leftGame.priceChfCents, leftPlayers: leftGame.avgPlayers24h,
    rightAppId: rightGame.steamAppId, rightTitle: rightGame.title, rightImage: rightGame.headerImage, rightYear: rightGame.releaseYear, rightPrice: rightGame.priceChfCents, rightPlayers: rightGame.avgPlayers24h,
  };

  await db.guess.create({
    data: { roundId: round.id, guessedAppId: rightGame.steamAppId, resultJson: init as object },
  });

  return NextResponse.json({
    round: {
      id: round.id,
      status: "active",
      score: 0,
      compareMode,
      leftGame: { steamAppId: leftGame.steamAppId, title: leftGame.title, headerImage: leftGame.headerImage, releaseYear: leftGame.releaseYear, priceChfCents: leftGame.priceChfCents, avgPlayers24h: leftGame.avgPlayers24h },
      rightGame: { steamAppId: rightGame.steamAppId, title: rightGame.title, headerImage: rightGame.headerImage },
      friendName: friendInput ? targetUser.displayName : undefined,
    },
  });
}
