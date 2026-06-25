import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile, getGameAchievements, getAchievementPercentages } from "@/lib/steam/api";

export type InitRecord = {
  type: "init";
  achievementName: string;
  achievementIconUrl: string;
  achievementDescription: string;
  achievementPercent: number;
};

export type GuessRecord = {
  type: "guess";
  guessedAppId: number;
  title: string;
  headerImage: string;
  won: boolean;
};

export type AchievementRound = {
  id: string;
  status: "active" | "won" | "lost";
  guesses: { guessedAppId: number; title: string; headerImage: string; won: boolean }[];
  maxGuesses: 5;
  clueLevel: 0 | 1 | 2 | 3;
  achievementName: string;
  achievementIconUrl?: string;
  achievementPercent?: number;
  achievementDescription?: string;
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
  challengeId?: string,
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
    challengeId,
  };
}

export async function GET() {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { steamId: session.user.steamId } });
  if (!user) return NextResponse.json({ round: null });

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, mode: "achievement", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true, target: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ round: null });

  const all = round.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
  const init = all[0] as InitRecord;
  const realGuesses = all.slice(1) as GuessRecord[];
  const isFriend = round.targetUserId !== user.id;

  return NextResponse.json({
    round: buildRound(
      round.id,
      round.status,
      init,
      realGuesses,
      round.game.title,
      round.game.headerImage,
      isFriend ? round.target.displayName : undefined,
    ),
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

  // Pick a game from the pool that has achievements
  const rows = await db.userGame.findMany({
    where: { userId: targetUser.id },
    include: {
      game: {
        select: {
          steamAppId: true,
          title: true,
          headerImage: true,
          tags: true,
          releaseYear: true,
          reviewPct: true,
          totalAchievements: true,
        },
      },
    },
  });

  const pool = rows
    .filter(
      (ug) =>
        ug.game.headerImage !== "" &&
        ug.game.tags.length > 0 &&
        ug.game.releaseYear !== null &&
        ug.game.reviewPct !== null &&
        (ug.game.totalAchievements ?? 0) > 0,
    )
    .map((ug) => ug.game);

  if (pool.length === 0) {
    return NextResponse.json(
      { error: friendInput ? "Friend's library has no eligible games yet." : "No eligible games found. Visit your library page first." },
      { status: 400 },
    );
  }

  // Shuffle pool and try up to 5 games until we find one with valid achievements
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  let chosenGame: typeof pool[0] | null = null;
  let chosenAchievement: { apiName: string; displayName: string; description: string; iconUrl: string } | null = null;
  let chosenPercent = 0;

  for (const game of shuffled.slice(0, 5)) {
    const [achievements, percentages] = await Promise.all([
      getGameAchievements(game.steamAppId),
      getAchievementPercentages(game.steamAppId),
    ]);
    if (achievements.length === 0) continue;
    const pick = achievements[Math.floor(Math.random() * achievements.length)];
    chosenGame = game;
    chosenAchievement = pick;
    chosenPercent = percentages[pick.apiName] ?? 0;
    break;
  }

  if (!chosenGame || !chosenAchievement) {
    return NextResponse.json(
      { error: "Could not find a game with achievements. Try again." },
      { status: 400 },
    );
  }

  const round = await db.round.create({
    data: {
      playerUserId: user.id,
      targetUserId: targetUser.id,
      targetAppId: chosenGame.steamAppId,
      mode: "achievement",
      status: "active",
    },
  });

  const init: InitRecord = {
    type: "init",
    achievementName: chosenAchievement.displayName,
    achievementIconUrl: chosenAchievement.iconUrl,
    achievementDescription: chosenAchievement.description,
    achievementPercent: Math.round(chosenPercent * 10) / 10,
  };

  await db.guess.create({
    data: { roundId: round.id, guessedAppId: chosenGame.steamAppId, resultJson: init as object },
  });

  return NextResponse.json({
    round: buildRound(
      round.id,
      "active",
      init,
      [],
      chosenGame.title,
      chosenGame.headerImage,
      friendInput ? targetUser.displayName : undefined,
    ),
  });
}
