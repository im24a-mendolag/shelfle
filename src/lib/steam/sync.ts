import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { getOwnedGames, getAppDetails, getSteamSpyInfo, getCurrentPlayers, getReviewScore, getGamePrices, mergeGameInfo } from "./api";

/** Upsert the user row on every login. Returns the DB user. */
export async function syncUser(steamId: string, displayName: string) {
  return db.user.upsert({
    where: { steamId },
    update: { displayName },
    create: { steamId, displayName },
  });
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function needsSync(syncedAt: Date | null): boolean {
  if (!syncedAt) return true;
  return Date.now() - syncedAt.getTime() > SYNC_INTERVAL_MS;
}

/**
 * Syncs a user's Steam library with the DB:
 * 1. Fetches owned games from Steam
 * 2. Ensures every game has at least a stub row in `games`
 * 3. Enriches games that have never been cached (tags/details missing)
 * 4. Upserts playtime into `user_games`
 */
export async function syncLibrary(userId: string, steamId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { syncedAt: true } });

  if (!needsSync(user?.syncedAt ?? null)) {
    log.info("Library sync skipped (synced recently)", { userId });
    const existing = await db.userGame.count({ where: { userId } });
    return existing;
  }

  const library = await getOwnedGames(steamId);
  const { games } = library;

  const BATCH = 100;

  // --- Step 1: stub-upsert all games so FK constraints are satisfied ---
  for (let i = 0; i < games.length; i += BATCH) {
    const batch = games.slice(i, i + BATCH);
    await db.$transaction(
      batch.map((g) =>
        db.game.upsert({
          where: { steamAppId: g.appid },
          update: {},
          create: {
            steamAppId: g.appid,
            title: g.name ?? `App ${g.appid}`,
            headerImage: "",
            tags: [],
          },
        })
      )
    );
  }

  // --- Step 2: upsert playtime for every game ---
  for (let i = 0; i < games.length; i += BATCH) {
    const batch = games.slice(i, i + BATCH);
    await db.$transaction(
      batch.map((g) =>
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

  // --- Step 3: enrich games that were never enriched or cached over 7 days ago ---
  const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const unenriched = await db.game.findMany({
    where: {
      steamAppId: { in: games.map((g) => g.appid) },
      OR: [
        { tags: { isEmpty: true } },
        { cachedAt: { lt: staleThreshold } },
      ],
    },
    select: { steamAppId: true },
  });

  log.info("Library sync", {
    steamId,
    total: games.length,
    unenriched: unenriched.length,
  });

  for (const { steamAppId } of unenriched.slice(0, 50)) {
    const playtime = games.find((g) => g.appid === steamAppId)?.playtime_forever ?? 0;
    const [details, spy, playerCount, reviewPct, prices] = await Promise.all([
      getAppDetails(steamAppId),
      getSteamSpyInfo(steamAppId),
      getCurrentPlayers(steamAppId),
      getReviewScore(steamAppId),
      getGamePrices(steamAppId),
    ]);
    const info = mergeGameInfo(steamAppId, playtime, details, spy, playerCount, reviewPct, prices);

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
        priceUsdCents: info.price_usd_cents,
        priceEurCents: info.price_eur_cents,
        priceChfCents: info.price_chf_cents,
        cachedAt: new Date(),
      },
    });
  }

  await db.user.update({ where: { id: userId }, data: { syncedAt: new Date() } });
  revalidateTag("library");

  return library.game_count;
}
