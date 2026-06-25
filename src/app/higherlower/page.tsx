import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";
import { db } from "@/lib/db";
import HigherLowerClient from "@/components/game/HigherLowerClient";

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

async function pickPool(userId: string): Promise<HLGame[]> {
  const rows = await db.userGame.findMany({
    where: { userId },
    include: { game: { select: { steamAppId: true, title: true, headerImage: true, tags: true, releaseYear: true, reviewPct: true, priceChfCents: true, avgPlayers24h: true } } },
  });
  return rows
    .filter((ug) => ug.game.headerImage !== "" && ug.game.tags.length > 0 && ug.game.releaseYear !== null && ug.game.reviewPct !== null)
    .map((ug) => ({ steamAppId: ug.game.steamAppId, title: ug.game.title, headerImage: ug.game.headerImage, releaseYear: ug.game.releaseYear as number, priceChfCents: ug.game.priceChfCents, avgPlayers24h: ug.game.avgPlayers24h }));
}

function pickFrom(pool: HLGame[], exclude: Set<number>): HLGame | null {
  const eligible = pool.filter((g) => !exclude.has(g.steamAppId));
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

export default async function HigherLowerPage({
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
    const chal = await db.challenge.findUnique({ where: { id: challenge } });
    if (!chal || chal.mode !== "higherlower" || chal.expiresAt < new Date()) redirect("/");
    const alreadyPlayed = await db.round.findFirst({ where: { playerUserId: user.id, challengeId: chal.id } });
    if (alreadyPlayed) redirect(`/challenge/${challenge}/results`);

    await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

    const compareMode: "year" | "price" | "players" = "year";
    const pool = await pickPool(chal.targetUserId);
    if (pool.length < 2) redirect("/");

    const leftGame = pool[Math.floor(Math.random() * pool.length)];
    const rightGame = pickFrom(pool, new Set([leftGame.steamAppId]))!;

    const round = await db.round.create({
      data: { playerUserId: user.id, targetUserId: chal.targetUserId, targetAppId: leftGame.steamAppId, mode: "higherlower", status: "active", challengeId: chal.id },
    });

    const init: InitRecord = {
      type: "init",
      compareMode,
      leftAppId: leftGame.steamAppId, leftTitle: leftGame.title, leftImage: leftGame.headerImage, leftYear: leftGame.releaseYear, leftPrice: leftGame.priceChfCents, leftPlayers: leftGame.avgPlayers24h,
      rightAppId: rightGame.steamAppId, rightTitle: rightGame.title, rightImage: rightGame.headerImage, rightYear: rightGame.releaseYear, rightPrice: rightGame.priceChfCents, rightPlayers: rightGame.avgPlayers24h,
    };

    await db.guess.create({ data: { roundId: round.id, guessedAppId: rightGame.steamAppId, resultJson: init as object } });

    return (
      <HigherLowerClient
        challengeId={chal.id}
        initialRound={{
          id: round.id,
          status: "active",
          score: 0,
          compareMode,
          leftGame: { steamAppId: leftGame.steamAppId, title: leftGame.title, headerImage: leftGame.headerImage, releaseYear: leftGame.releaseYear, priceChfCents: leftGame.priceChfCents, avgPlayers24h: leftGame.avgPlayers24h },
          rightGame: { steamAppId: rightGame.steamAppId, title: rightGame.title, headerImage: rightGame.headerImage },
        }}
      />
    );
  }

  // ── Normal mode ───────────────────────────────────────────────────────────

  // For solo: resume existing active round if present
  if (!friend) {
    const existing = await db.round.findFirst({
      where: { playerUserId: user.id, targetUserId: user.id, mode: "higherlower", status: "active" },
      include: { guesses: { orderBy: { guessedAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    if (existing && existing.guesses.length > 0) {
      const all = existing.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
      const init = all[0] as InitRecord;
      const realGuesses = all.slice(1) as GuessRecord[];
      const last = realGuesses[realGuesses.length - 1];
      const compareMode: "year" | "price" | "players" = init.compareMode ?? "year";

      const leftGame: HLGame = last
        ? { steamAppId: last.rightAppId, title: last.rightTitle, headerImage: last.rightImage, releaseYear: last.rightYear, priceChfCents: last.rightPrice ?? null, avgPlayers24h: last.rightPlayers ?? null }
        : { steamAppId: init.leftAppId, title: init.leftTitle, headerImage: init.leftImage, releaseYear: init.leftYear, priceChfCents: init.leftPrice ?? null, avgPlayers24h: init.leftPlayers ?? null };
      const rightGame = last
        ? { steamAppId: last.nextRightAppId!, title: last.nextRightTitle!, headerImage: last.nextRightImage! }
        : { steamAppId: init.rightAppId, title: init.rightTitle, headerImage: init.rightImage };
      const score = last?.score ?? 0;

      return (
        <HigherLowerClient
          challengeId={existing.challengeId ?? undefined}
          initialRound={{ id: existing.id, status: existing.status as "active" | "lost", score, compareMode, leftGame, rightGame }}
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

  const compareMode: "year" | "price" | "players" = "year";
  const pool = await pickPool(targetUser.id);
  if (pool.length < 2) {
    return <HigherLowerClient defaultFriend={friend} defaultFriendName={resolvedFriendName} defaultFriendAvatar={friendAvatar} />;
  }

  const leftGame = pool[Math.floor(Math.random() * pool.length)];
  const rightGame = pickFrom(pool, new Set([leftGame.steamAppId]))!;

  const round = await db.round.create({
    data: { playerUserId: user.id, targetUserId: targetUser.id, targetAppId: leftGame.steamAppId, mode: "higherlower", status: "active" },
  });

  const init: InitRecord = {
    type: "init",
    compareMode,
    leftAppId: leftGame.steamAppId, leftTitle: leftGame.title, leftImage: leftGame.headerImage, leftYear: leftGame.releaseYear, leftPrice: leftGame.priceChfCents, leftPlayers: leftGame.avgPlayers24h,
    rightAppId: rightGame.steamAppId, rightTitle: rightGame.title, rightImage: rightGame.headerImage, rightYear: rightGame.releaseYear, rightPrice: rightGame.priceChfCents, rightPlayers: rightGame.avgPlayers24h,
  };

  await db.guess.create({ data: { roundId: round.id, guessedAppId: rightGame.steamAppId, resultJson: init as object } });

  return (
    <HigherLowerClient
      initialRound={{
        id: round.id,
        status: "active",
        score: 0,
        compareMode,
        leftGame: { steamAppId: leftGame.steamAppId, title: leftGame.title, headerImage: leftGame.headerImage, releaseYear: leftGame.releaseYear, priceChfCents: leftGame.priceChfCents, avgPlayers24h: leftGame.avgPlayers24h },
        rightGame: { steamAppId: rightGame.steamAppId, title: rightGame.title, headerImage: rightGame.headerImage },
        friendName: friend ? resolvedFriendName : undefined,
      }}
      defaultFriend={friend}
      defaultFriendName={resolvedFriendName}
      defaultFriendAvatar={friendAvatar}
    />
  );
}
