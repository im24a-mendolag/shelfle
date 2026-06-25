import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";

const MAX_GUESSES = 3;

export type InitRecord = {
  type: "init";
  playtimeHours: number;
  avgPlayers24h: number | null;
  firstLetter: string;
};

export type GuessRecord = {
  type: "guess";
  guessedAppId: number;
  title: string;
  headerImage: string;
  won: boolean;
};

export type PlaytimeRound = {
  id: string;
  status: "active" | "won" | "lost";
  guesses: { guessedAppId: number; title: string; headerImage: string; won: boolean }[];
  maxGuesses: 3;
  playtimeHours: number;
  avgPlayers24h?: number | null;
  firstLetter?: string;
  targetTitle?: string;
  targetHeaderImage?: string;
  friendName?: string;
  challengeId?: string;
};

function buildRound(
  roundId: string,
  status: string,
  init: InitRecord,
  realGuesses: GuessRecord[],
  targetTitle: string,
  targetHeaderImage: string,
  friendName?: string,
): PlaytimeRound {
  const wrongCount = realGuesses.filter((g) => !g.won).length;
  const isOver = status === "won" || status === "lost";
  return {
    id: roundId,
    status: status as "active" | "won" | "lost",
    guesses: realGuesses.map((g) => ({ guessedAppId: g.guessedAppId, title: g.title, headerImage: g.headerImage, won: g.won })),
    maxGuesses: MAX_GUESSES,
    playtimeHours: init.playtimeHours,
    avgPlayers24h: wrongCount >= 1 || isOver ? init.avgPlayers24h : undefined,
    firstLetter: wrongCount >= 2 || isOver ? init.firstLetter : undefined,
    targetTitle: isOver ? targetTitle : undefined,
    targetHeaderImage: isOver ? targetHeaderImage : undefined,
    friendName,
  };
}

export async function GET() {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { steamId: session.user.steamId } });
  if (!user) return NextResponse.json({ round: null });

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, mode: "playtime", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true, target: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round || round.guesses.length === 0) return NextResponse.json({ round: null });

  const all = round.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
  const init = all[0] as InitRecord;
  const realGuesses = all.slice(1) as GuessRecord[];
  const isFriend = round.targetUserId !== user.id;

  return NextResponse.json({
    round: buildRound(round.id, round.status, init, realGuesses, round.game.title, round.game.headerImage, isFriend ? round.target.displayName : undefined),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await syncUser(session.user.steamId, session.user.name ?? "");

  await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

  const body = await req.json().catch(() => ({}));
  const friendInput: string | undefined = body.friendSteamId;
  let targetUser = user;

  if (friendInput) {
    const friendSteamId = await resolveSteamId(friendInput);
    if (!friendSteamId) {
      return NextResponse.json({ error: "Could not resolve Steam ID." }, { status: 400 });
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
        { error: err instanceof Error ? err.message : "Failed to sync friend's library." },
        { status: 400 },
      );
    }
    revalidateTag("game-search");
    revalidateTag("library");
  }

  const rows = await db.userGame.findMany({
    where: { userId: targetUser.id, playtimeHours: { gt: 0 } },
    include: {
      game: {
        select: { steamAppId: true, title: true, headerImage: true, tags: true, releaseYear: true, reviewPct: true, avgPlayers24h: true },
      },
    },
  });

  const pool = rows.filter(
    (ug) => ug.game.headerImage !== "" && ug.game.tags.length > 0 && ug.game.releaseYear !== null && ug.game.reviewPct !== null,
  );

  if (pool.length === 0) {
    return NextResponse.json({ error: friendInput ? "Friend's library has no eligible games." : "No eligible games found." }, { status: 400 });
  }

  const pick = pool[Math.floor(Math.random() * pool.length)];

  const round = await db.round.create({
    data: { playerUserId: user.id, targetUserId: targetUser.id, targetAppId: pick.game.steamAppId, mode: "playtime", status: "active" },
  });

  const init: InitRecord = {
    type: "init",
    playtimeHours: pick.playtimeHours,
    avgPlayers24h: pick.game.avgPlayers24h,
    firstLetter: pick.game.title.replace(/[™®©]/g, "").trim().charAt(0).toUpperCase(),
  };

  await db.guess.create({ data: { roundId: round.id, guessedAppId: pick.game.steamAppId, resultJson: init as object } });

  return NextResponse.json({
    round: buildRound(round.id, "active", init, [], pick.game.title, pick.game.headerImage, friendInput ? targetUser.displayName : undefined),
  });
}
