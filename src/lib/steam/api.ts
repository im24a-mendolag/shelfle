import { log } from "@/lib/logger";
import type {
  SteamLibrary,
  SteamAppDetails,
  SteamSpyAppInfo,
  GameInfo,
} from "./types";

const STEAM_API_KEY = process.env.STEAM_API_KEY!;
const STEAM_API_BASE = "https://api.steampowered.com";
const STORE_API_BASE = "https://store.steampowered.com/api";
const STEAMSPY_BASE = "https://steamspy.com/api.php";

/** Resolves a Steam vanity URL name to a 64-bit Steam ID string. */
async function resolveVanityUrl(vanity: string): Promise<string | null> {
  try {
    const url = new URL(`${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/`);
    url.searchParams.set("key", STEAM_API_KEY);
    url.searchParams.set("vanityurl", vanity);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.response?.success === 1 ? String(data.response.steamid) : null;
  } catch {
    return null;
  }
}

/**
 * Accepts a Steam ID (17-digit), profile URL, vanity URL, or vanity name.
 * Returns the canonical 17-digit Steam ID string, or null if unresolvable.
 */
export async function resolveSteamId(input: string): Promise<string | null> {
  const s = input.trim().replace(/\/$/, "");
  const profileMatch = s.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profileMatch) return profileMatch[1];
  const vanityMatch = s.match(/steamcommunity\.com\/id\/([^/?]+)/);
  if (vanityMatch) return resolveVanityUrl(vanityMatch[1]);
  if (/^\d{17}$/.test(s)) return s;
  return resolveVanityUrl(s);
}

/** Returns display name + avatar URL for a Steam ID. */
export async function getSteamProfile(steamId: string): Promise<{ displayName: string; avatarUrl: string | null }> {
  try {
    const url = new URL(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`);
    url.searchParams.set("key", STEAM_API_KEY);
    url.searchParams.set("steamids", steamId);
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) return { displayName: steamId, avatarUrl: null };
    const data = await res.json();
    const player = data?.response?.players?.[0];
    return { displayName: player?.personaname ?? steamId, avatarUrl: player?.avatarmedium ?? null };
  } catch {
    return { displayName: steamId, avatarUrl: null };
  }
}


/**
 * Fetches all games owned by a Steam user.
 * Requires the profile and game details to be set to public.
 */
export async function getOwnedGames(steamId: string): Promise<SteamLibrary> {
  const url = new URL(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`);
  url.searchParams.set("key", STEAM_API_KEY);
  url.searchParams.set("steamid", steamId);
  url.searchParams.set("include_appinfo", "true");
  url.searchParams.set("include_played_free_games", "true");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
  if (!res.ok) {
    log.error("GetOwnedGames failed", { steamId, status: res.status });
    throw new Error(`Steam GetOwnedGames failed: ${res.status}`);
  }

  const data = await res.json();
  const response = data?.response;

  if (!response || !response.games) {
    log.warn("GetOwnedGames returned no games — profile may be private", { steamId });
    throw new Error(
      "No games returned — the Steam profile or game details may be set to private."
    );
  }

  return response as SteamLibrary;
}

/** Fetches price for a single app in a given Steam country code (e.g. "us", "de", "ch"). */
async function fetchPriceCents(appId: number, cc: string): Promise<number | null> {
  try {
    const url = new URL(`${STORE_API_BASE}/appdetails`);
    url.searchParams.set("appids", String(appId));
    url.searchParams.set("cc", cc);
    const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    const data = await res.json();
    const entry = data?.[String(appId)];
    if (!entry?.success) return null;
    if (entry.data.is_free) return 0;
    return entry.data.price_overview?.final ?? null;
  } catch {
    return null;
  }
}

/** Fetches CHF price for an app. */
export async function getGamePrices(appId: number) {
  const chf = await fetchPriceCents(appId, "ch");
  return { chf };
}

/**
 * Fetches store details for a single app (name, genres, achievements, release date, etc.)
 * Returns null if the app is not found or the API fails.
 */
export async function getAppDetails(
  appId: number
): Promise<SteamAppDetails | null> {
  try {
    const url = new URL(`${STORE_API_BASE}/appdetails`);
    url.searchParams.set("appids", String(appId));
    url.searchParams.set("l", "english");

    const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      log.warn("getAppDetails non-JSON response", { appId, contentType });
      return null;
    }

    const data = await res.json();
    const entry = data?.[String(appId)];
    if (!entry?.success) return null;

    return entry.data as SteamAppDetails;
  } catch (err) {
    log.error("getAppDetails threw", { appId, err: String(err) });
    return null;
  }
}

/**
 * Fetches SteamSpy metadata: tags, CCU, review breakdown, owner estimates.
 */
export async function getSteamSpyInfo(
  appId: number
): Promise<SteamSpyAppInfo | null> {
  try {
    const url = new URL(STEAMSPY_BASE);
    url.searchParams.set("request", "appinfo");
    url.searchParams.set("appid", String(appId));

    const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      log.warn("getSteamSpyInfo non-JSON response", { appId, contentType });
      return null;
    }

    const data = await res.json();
    return data as SteamSpyAppInfo;
  } catch (err) {
    log.error("getSteamSpyInfo threw", { appId, err: String(err) });
    return null;
  }
}

/**
 * Fetches review score directly from the Steam Store reviews endpoint.
 * Returns percentage of positive reviews (0-100), or null on failure.
 * No API key required.
 */
export async function getReviewScore(appId: number): Promise<number | null> {
  try {
    const url = `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.query_summary;
    if (!summary || summary.total_reviews === 0) return null;
    return Math.round((summary.total_positive / summary.total_reviews) * 100);
  } catch {
    return null;
  }
}

export interface SteamFriend {
  steamId: string;
  displayName: string;
  avatarUrl: string;
}

/**
 * Fetches the friend list for a Steam user and returns enriched summaries.
 * Returns an empty array if the profile is private or the call fails.
 */
export async function getSteamFriends(steamId: string): Promise<SteamFriend[]> {
  try {
    const listUrl = new URL(`${STEAM_API_BASE}/ISteamUser/GetFriendList/v1/`);
    listUrl.searchParams.set("key", STEAM_API_KEY);
    listUrl.searchParams.set("steamid", steamId);
    listUrl.searchParams.set("relationship", "friend");
    const listRes = await fetch(listUrl.toString(), { next: { revalidate: 300 } });
    if (!listRes.ok) return [];
    const listData = await listRes.json();
    const friends: { steamid: string }[] = listData?.friendslist?.friends ?? [];
    if (friends.length === 0) return [];

    const ids = friends.slice(0, 100).map((f) => f.steamid).join(",");
    const sumUrl = new URL(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`);
    sumUrl.searchParams.set("key", STEAM_API_KEY);
    sumUrl.searchParams.set("steamids", ids);
    const sumRes = await fetch(sumUrl.toString(), { next: { revalidate: 300 } });
    if (!sumRes.ok) return [];
    const sumData = await sumRes.json();
    const players: { steamid: string; personaname: string; avatarmedium: string }[] =
      sumData?.response?.players ?? [];

    return players
      .map((p) => ({ steamId: p.steamid, displayName: p.personaname, avatarUrl: p.avatarmedium }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {
    return [];
  }
}

/**
 * Fetches current concurrent players for an app directly from Steam.
 * No API key required.
 */
export async function getCurrentPlayers(appId: number): Promise<number | null> {
  try {
    const url = `${STEAM_API_BASE}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    const count = data?.response?.player_count;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

function parseReleaseYear(dateStr: string): number | null {
  const match = dateStr.match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Parses disk size from the Steam Store pc_requirements HTML string.
 * Strips HTML tags first so it handles any tag structure around "Storage:".
 */
function parseDiskSizeGb(minimum?: string): number | null {
  if (!minimum) return null;
  const text = minimum.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = text.match(
    /(?:Storage|Hard Disk Space|HDD|Disk Space)\s*:\s*[^0-9]*([\d,.]+)\s*(GB|MB|TB)/i
  );
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ""));
  const unit = match[2].toUpperCase();
  if (unit === "TB") return Math.round(value * 1024 * 10) / 10;
  if (unit === "MB") return Math.round((value / 1024) * 10) / 10;
  return Math.round(value * 10) / 10;
}

/**
 * Merges Steam Store + SteamSpy + player count into a normalized GameInfo object.
 */
export function mergeGameInfo(
  appId: number,
  playtimeMinutes: number,
  details: SteamAppDetails | null,
  spy: SteamSpyAppInfo | null,
  playerCount: number | null = null,
  reviewPctOverride: number | null = null,
  prices: { chf: number | null } = { chf: null },
): GameInfo {
  const spyTags = spy?.tags ? Object.keys(spy.tags).slice(0, 10) : [];
  const storeTags = [
    ...(details?.genres?.map((g) => g.description) ?? []),
    ...(details?.categories?.map((c) => c.description) ?? []),
  ];
  const tags = spyTags.length > 0 ? spyTags : storeTags.slice(0, 10);

  const spyReviewPct =
    spy && spy.positive + spy.negative > 0
      ? Math.round((spy.positive / (spy.positive + spy.negative)) * 100)
      : null;
  const reviewPct = reviewPctOverride ?? spyReviewPct;

  return {
    steam_app_id: appId,
    title: details?.name ?? spy?.name ?? `App ${appId}`,
    header_image: details?.header_image ?? "",
    tags,
    release_year: details?.release_date?.date
      ? parseReleaseYear(details.release_date.date)
      : null,
    review_pct: reviewPct,
    total_achievements: details !== null ? (details.achievements?.total ?? 0) : null,
    avg_players_24h: playerCount ?? spy?.ccu ?? null,
    price_chf_cents: prices.chf,
    playtime_hours: Math.round(playtimeMinutes / 60),
    metacritic_score: details?.metacritic?.score ?? null,
  };
}

export type AchievementInfo = {
  apiName: string;
  displayName: string;
  description: string;
  iconUrl: string;
};

/** Returns achievements for a game that have both a display name and description. */
export async function getGameAchievements(appId: number): Promise<AchievementInfo[]> {
  try {
    const url = new URL(`${STEAM_API_BASE}/ISteamUserStats/GetSchemaForGame/v2/`);
    url.searchParams.set("key", STEAM_API_KEY);
    url.searchParams.set("appid", String(appId));
    url.searchParams.set("l", "english");
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const achievements: unknown[] = data?.game?.availableGameStats?.achievements ?? [];
    return (achievements as Array<{
      name: string;
      displayName?: string;
      description?: string;
      icon?: string;
      hidden?: number;
    }>)
      .filter((a) => a.hidden !== 1 && a.displayName && a.description && a.icon)
      .map((a) => ({
        apiName: a.name,
        displayName: a.displayName!,
        description: a.description!,
        iconUrl: a.icon!,
      }));
  } catch {
    return [];
  }
}

/** Fetches the short_description for an app via the full appdetails endpoint. */
export async function getShortDescription(appId: number): Promise<string | null> {
  const details = await getAppDetails(appId);
  return (details?.short_description as string) || null;
}

/** Returns a map of achievement API name → global unlock percentage. */
export async function getAchievementPercentages(appId: number): Promise<Record<string, number>> {
  try {
    const url = new URL(`${STEAM_API_BASE}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/`);
    url.searchParams.set("gameid", String(appId));
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return {};
    const data = await res.json();
    const list: { name: string; percent: number }[] =
      data?.achievementpercentages?.achievements ?? [];
    return Object.fromEntries(list.map((a) => [a.name, a.percent]));
  } catch {
    return {};
  }
}
