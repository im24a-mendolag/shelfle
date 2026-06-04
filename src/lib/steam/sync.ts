import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { getOwnedGames, getAppDetails, getCurrentPlayers, getReviewScore, getGamePrices, mergeGameInfo } from "./api";

/** Upsert the user row on every login. Returns the DB user. */
export async function syncUser(steamId: string, displayName: string) {
  return db.user.upsert({
    where: { steamId },
    update: { displayName },
    create: { steamId, displayName },
  });
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function needsListSync(syncedAt: Date | null): boolean {
  if (!syncedAt) return true;
  return Date.now() - syncedAt.getTime() > SYNC_INTERVAL_MS;
}

/**
 * Syncs a user's Steam library:
 * - List sync (Steam API fetch + stub upserts): gated by syncedAt, once per hour
 * - Enrichment (details/prices/review): always runs until all games are enriched
 */
export async function syncLibrary(userId: string, steamId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { syncedAt: true } });

  let gameCount: number;

  if (needsListSync(user?.syncedAt ?? null)) {
    const library = await getOwnedGames(steamId);
    const { games } = library;

    // Stub-insert all games (single query, skip existing)
    await db.game.createMany({
      data: games.map((g) => ({
        steamAppId: g.appid,
        title: g.name ?? `App ${g.appid}`,
        headerImage: "",
        tags: [],
      })),
      skipDuplicates: true,
    });

    // Upsert playtime for every game (parallel chunks)
    const CHUNK = 25;
    for (let i = 0; i < games.length; i += CHUNK) {
      await Promise.all(
        games.slice(i, i + CHUNK).map((g) =>
          db.userGame.upsert({
            where: { userId_steamAppId: { userId, steamAppId: g.appid } },
            update: { playtimeHours: Math.round(g.playtime_forever / 60) },
            create: {
              userId,
              steamAppId: g.appid,
              playtimeHours: Math.round(g.playtime_forever / 60),
            },
          })
        )
      );
    }

    await db.user.update({ where: { id: userId }, data: { syncedAt: new Date() } });
    gameCount = library.game_count;
  } else {
    gameCount = await db.userGame.count({ where: { userId } });
  }

  // Enrichment always runs — keeps going across visits until all games are done
  const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toEnrich = await db.game.findMany({
    where: {
      userGames: { some: { userId } },
      OR: [
        { tags: { isEmpty: true } },
        { cachedAt: { lt: staleThreshold } },
      ],
    },
    select: { steamAppId: true, tags: true },
  });

  const needsFull = toEnrich.filter((g) => g.tags.length === 0).slice(0, 50);
  const needsRefresh = toEnrich.filter((g) => g.tags.length > 0).slice(0, 50);

  log.info("Library sync", {
    steamId,
    listSynced: needsListSync(user?.syncedAt ?? null),
    gameCount,
    enrichFull: needsFull.length,
    enrichRefresh: needsRefresh.length,
    enrichRemaining: Math.max(0, toEnrich.length - needsFull.length - needsRefresh.length),
  });

  for (const { steamAppId } of needsFull) {
    const [details, playerCount, reviewPct, prices] = await Promise.all([
      getAppDetails(steamAppId),
      getCurrentPlayers(steamAppId),
      getReviewScore(steamAppId),
      getGamePrices(steamAppId),
    ]);
    const info = mergeGameInfo(steamAppId, 0, details, null, playerCount, reviewPct, prices);
    await db.game.update({
      where: { steamAppId },
      data: {
        title: info.title,
        headerImage: info.header_image,
        tags: info.tags,
        releaseYear: info.release_year,
        reviewPct: info.review_pct,
        totalAchievements: info.total_achievements,
        avgPlayers24h: info.avg_players_24h,
        priceChfCents: info.price_chf_cents,
        cachedAt: new Date(),
      },
    });
  }

  for (const { steamAppId } of needsRefresh) {
    const [playerCount, reviewPct] = await Promise.all([
      getCurrentPlayers(steamAppId),
      getReviewScore(steamAppId),
    ]);
    await db.game.update({
      where: { steamAppId },
      data: {
        ...(reviewPct !== null ? { reviewPct } : {}),
        ...(playerCount !== null ? { avgPlayers24h: playerCount } : {}),
        cachedAt: new Date(),
      },
    });
  }

  return gameCount;
}
