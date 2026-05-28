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
  if (!res.ok) throw new Error(`Steam GetOwnedGames failed: ${res.status}`);

  const data = await res.json();
  const response = data?.response;

  if (!response || !response.games) {
    throw new Error(
      "No games returned — the Steam profile or game details may be set to private."
    );
  }

  return response as SteamLibrary;
}

/**
 * Fetches store details for a single app (name, genres, achievements, release date, etc.)
 * Returns null if the app is not found or the API fails.
 */
export async function getAppDetails(
  appId: number
): Promise<SteamAppDetails | null> {
  const url = new URL(`${STORE_API_BASE}/appdetails`);
  url.searchParams.set("appids", String(appId));
  url.searchParams.set("l", "english");

  const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
  if (!res.ok) return null;

  const data = await res.json();
  const entry = data?.[String(appId)];
  if (!entry?.success) return null;

  return entry.data as SteamAppDetails;
}

/**
 * Fetches SteamSpy metadata: tags, CCU, review breakdown, owner estimates.
 */
export async function getSteamSpyInfo(
  appId: number
): Promise<SteamSpyAppInfo | null> {
  const url = new URL(STEAMSPY_BASE);
  url.searchParams.set("request", "appinfo");
  url.searchParams.set("appid", String(appId));

  const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
  if (!res.ok) return null;

  const data = await res.json();
  return data as SteamSpyAppInfo;
}

/**
 * Parses a Steam release date string like "21 Nov, 2019" → 2019.
 * Returns null if unparseable.
 */
function parseReleaseYear(dateStr: string): number | null {
  const match = dateStr.match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Converts disk size from bytes to GB, rounded to 1 decimal place.
 */
function bytesToGb(bytes?: number): number | null {
  if (!bytes) return null;
  return Math.round((bytes / 1_073_741_824) * 10) / 10;
}

/**
 * Merges Steam Store + SteamSpy data into a normalized GameInfo object.
 */
export function mergeGameInfo(
  appId: number,
  playtimeMinutes: number,
  details: SteamAppDetails | null,
  spy: SteamSpyAppInfo | null
): GameInfo {
  const tags = spy?.tags ? Object.keys(spy.tags).slice(0, 10) : [];

  const reviewPct =
    spy && spy.positive + spy.negative > 0
      ? Math.round((spy.positive / (spy.positive + spy.negative)) * 100)
      : null;

  // pc_requirements minimum field contains an HTML string — we skip disk size here
  // (requires parsing HTML; stored separately via an enrichment job)
  return {
    steam_app_id: appId,
    title: details?.name ?? spy?.name ?? `App ${appId}`,
    header_image: details?.header_image ?? "",
    tags,
    release_year: details?.release_date?.date
      ? parseReleaseYear(details.release_date.date)
      : null,
    review_pct: reviewPct,
    total_achievements: details?.achievements?.total ?? null,
    avg_players_24h: spy?.ccu ?? null,
    disk_size_gb: null,
    playtime_hours: Math.round(playtimeMinutes / 60),
    metacritic_score: details?.metacritic?.score ?? null,
  };
}

/**
 * Fetches the full enriched library for a Steam user.
 * Calls getOwnedGames, then enriches each game with Store + SteamSpy data.
 *
 * @param steamId   64-bit Steam ID
 * @param limit     Cap the number of enriched games (default: all). Useful during dev.
 */
export async function getEnrichedLibrary(
  steamId: string,
  limit?: number
): Promise<GameInfo[]> {
  const library = await getOwnedGames(steamId);
  const games = limit ? library.games.slice(0, limit) : library.games;

  const results = await Promise.allSettled(
    games.map(async (game) => {
      const [details, spy] = await Promise.all([
        getAppDetails(game.appid),
        getSteamSpyInfo(game.appid),
      ]);
      return mergeGameInfo(game.appid, game.playtime_forever, details, spy);
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<GameInfo> => r.status === "fulfilled")
    .map((r) => r.value);
}
