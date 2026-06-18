import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile, getGameAchievements, getAchievementPercentages } from "@/lib/steam/api";
import { db } from "@/lib/db";
import AchievementClient from "@/components/game/AchievementClient";
import type { InitRecord, GuessRecord, AchievementRound } from "@/app/api/achievement/route";

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
    guesses: realGuesses.map((g) => ({ guessedAppId: g.guessedAppId, title: g.title, headerImage: g.headerImage, won: g.won })),
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

export default async function AchievementPage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; friendName?: string; friendAvatar?: string }>;
}) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) redirect("/");

  const user = await syncUser(session.user.steamId, session.user.name ?? "");
  await syncLibrary(user.id, session.user.steamId);

  const { friend, friendName, friendAvatar } = await searchParams;

  // For solo: resume existing active round if present
  if (!friend) {
    const existing = await db.round.findFirst({
      where: { playerUserId: user.id, targetUserId: user.id, mode: "achievement", status: "active" },
      include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing && existing.guesses.length > 0) {
      const all = existing.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
      const init = all[0] as InitRecord;
      const realGuesses = all.slice(1) as GuessRecord[];
      return (
        <AchievementClient
          initialRound={buildRound(existing.id, existing.status, init, realGuesses, existing.game.title, existing.game.headerImage)}
        />
      );
    }
  }

  // Abandon any existing active rounds
  await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

  let targetUser = user;
  let resolvedFriendName = friendName;

  if (friend) {
    try {
      const friendSteamId = await resolveSteamId(friend);
      if (friendSteamId && friendSteamId !== session.user.steamId) {
        const { displayName } = await getSteamProfile(friendSteamId);
        targetUser = await syncUser(friendSteamId, displayName);
        await syncLibrary(targetUser.id, friendSteamId);
        revalidateTag("library");
        revalidateTag("game-search");
        resolvedFriendName = displayName;
      }
    } catch {
      // fall through to solo on error
    }
  }

  const rows = await db.userGame.findMany({
    where: { userId: targetUser.id },
    include: { game: { select: { steamAppId: true, title: true, headerImage: true, tags: true, releaseYear: true, reviewPct: true, totalAchievements: true } } },
  });

  const pool = rows
    .filter((ug) => ug.game.headerImage !== "" && ug.game.tags.length > 0 && ug.game.releaseYear !== null && ug.game.reviewPct !== null && (ug.game.totalAchievements ?? 0) > 0)
    .map((ug) => ug.game);

  if (pool.length === 0) {
    return <AchievementClient defaultFriend={friend} defaultFriendName={resolvedFriendName} defaultFriendAvatar={friendAvatar} />;
  }

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
    return <AchievementClient defaultFriend={friend} defaultFriendName={resolvedFriendName} defaultFriendAvatar={friendAvatar} />;
  }

  const round = await db.round.create({
    data: { playerUserId: user.id, targetUserId: targetUser.id, targetAppId: chosenGame.steamAppId, mode: "achievement", status: "active" },
  });

  const init: InitRecord = {
    type: "init",
    achievementName: chosenAchievement.displayName,
    achievementIconUrl: chosenAchievement.iconUrl,
    achievementDescription: chosenAchievement.description,
    achievementPercent: Math.round(chosenPercent * 10) / 10,
  };

  await db.guess.create({ data: { roundId: round.id, guessedAppId: chosenGame.steamAppId, resultJson: init as object } });

  return (
    <AchievementClient
      initialRound={buildRound(round.id, "active", init, [], chosenGame.title, chosenGame.headerImage, friend ? resolvedFriendName : undefined)}
      defaultFriend={friend}
      defaultFriendName={resolvedFriendName}
      defaultFriendAvatar={friendAvatar}
    />
  );
}
