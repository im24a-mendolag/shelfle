export interface SteamOwnedGame {
  appid: number;
  name?: string;
  playtime_forever: number; // minutes
  playtime_2weeks?: number;
  img_icon_url?: string;
  img_logo_url?: string;
}

export interface SteamLibrary {
  game_count: number;
  games: SteamOwnedGame[];
}

export interface SteamAppDetails {
  steam_appid: number;
  name: string;
  short_description: string;
  header_image: string;
  is_free: boolean;
  release_date: { coming_soon: boolean; date: string };
  genres: { id: string; description: string }[];
  categories: { id: number; description: string }[];
  metacritic?: { score: number; url: string };
  achievements?: { total: number };
  pc_requirements?: { minimum?: string; recommended?: string };
  price_overview?: {
    currency: string;
    initial: number;
    final: number;
    discount_percent: number;
    final_formatted: string;
  };
}

export interface SteamSpyAppInfo {
  appid: number;
  name: string;
  developer: string;
  publisher: string;
  score_rank: string;
  positive: number;
  negative: number;
  userscore: number;
  owners: string;
  average_forever: number; // minutes
  average_2weeks: number;
  median_forever: number;
  ccu: number; // peak concurrent
  tags: Record<string, number>;
}

/** Normalized game data used across the app */
export interface GameInfo {
  steam_app_id: number;
  title: string;
  header_image: string;
  tags: string[];
  release_year: number | null;
  review_pct: number | null;
  total_achievements: number | null;
  avg_players_24h: number | null;
  price_usd_cents: number | null;
  price_eur_cents: number | null;
  price_chf_cents: number | null;
  playtime_hours: number;
  metacritic_score: number | null;
}
