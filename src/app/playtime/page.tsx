import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";
import { db } from "@/lib/db";
import PlaytimeClient from "@/components/game/PlaytimeClient";
import type { InitRecord, GuessRecord, PlaytimeRound } from "@/app/api/playtime/route";

const MAX_GUESSES = 3;

function buildRound(
  roundId: string,
  status: string,
  init: InitRecord,
  realGuesses: GuessRecord[],
  targetTitle: string,
  targetHeaderImage: string,
  friendName?: string,
  challengeId?: string,
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
    challengeId,
  };
}

export default async function PlaytimePage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; friendName?: string; friendAvatar?: string; challenge?: string }>;
}) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) redirect("/");

  const user = await syncUser(session.user.steamId, session.user.name ?? "");
  await syncLibrary(user.id, session.user.steamId);

  const { friend, friendName, friendAvatar, challenge } = await searchParams;

  // ── Challenge mode ────────────────────────────────────────────────────────
  if (challenge) {
    const chal = await db.challenge.findUnique({
      where: { id: challenge },
      include: {
        rounds: { include: { guesses: { orderBy: { guessedAt: "asc" } } }, orderBy: { createdAt: "asc" } },
        game: true,
      },
    });
    if (!chal || chal.mode !== "playtime" || !chal.gameAppId || chal.expiresAt < new Date()) redirect("/");
    const alreadyPlayed = await db.round.findFirst({ where: { playerUserId: user.id, challengeId: chal.id } });
    if (alreadyPlayed) redirect(`/challenge/${challenge}/results`);

    const creatorRound = chal.rounds.find((r) => r.playerUserId === chal.creatorId);
    const creatorInit = creatorRound?.guesses[0]?.resultJson as InitRecord | undefined;
    if (!creatorInit || !chal.game) redirect("/");

    await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

    const round = await db.round.create({
      data: { playerUserId: user.id, targetUserId: chal.targetUserId, targetAppId: chal.gameAppId, mode: "playtime", status: "active", challengeId: chal.id },
    });
    await db.guess.create({ data: { roundId: round.id, guessedAppId: chal.gameAppId, resultJson: creatorInit as object } });

    return (
      <PlaytimeClient
        challengeId={chal.id}
        initialRound={buildRound(round.id, "active", creatorInit, [], chal.game.title, chal.game.headerImage, undefined, chal.id)}
      />
    );
  }

  // ── Normal mode ───────────────────────────────────────────────────────────

  if (!friend) {
    const existing = await db.round.findFirst({
      where: { playerUserId: user.id, targetUserId: user.id, mode: "playtime", status: "active" },
      include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing && existing.guesses.length > 0) {
      const all = existing.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
      const init = all[0] as InitRecord;
      const realGuesses = all.slice(1) as GuessRecord[];
      return (
        <PlaytimeClient
          challengeId={existing.challengeId ?? undefined}
          initialRound={buildRound(existing.id, existing.status, init, realGuesses, existing.game.title, existing.game.headerImage, undefined, existing.challengeId ?? undefined)}
        />
      );
    }
  }

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
      // fall through to solo
    }
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
    return <PlaytimeClient defaultFriend={friend} defaultFriendName={resolvedFriendName} defaultFriendAvatar={friendAvatar} />;
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

  return (
    <PlaytimeClient
      initialRound={buildRound(round.id, "active", init, [], pick.game.title, pick.game.headerImage, friend ? resolvedFriendName : undefined)}
      defaultFriend={friend}
      defaultFriendName={resolvedFriendName}
      defaultFriendAvatar={friendAvatar}
    />
  );
}
