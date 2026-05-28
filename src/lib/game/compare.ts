export type NumericStatus =
  | "exact"
  | "close_higher"
  | "close_lower"
  | "higher"
  | "lower"
  | "unknown";

export type NumericResult = {
  value: number | null;
  status: NumericStatus;
};

export type TagResult = {
  value: string[];
  overlap: string[];
  status: "exact" | "partial" | "none";
};

export type GuessComparison = {
  guessedAppId: number;
  title: string;
  headerImage: string;
  tags: TagResult;
  releaseYear: NumericResult;
  reviewPct: NumericResult;
  totalAchievements: NumericResult;
  avgPlayers24h: NumericResult;
  priceChfCents: NumericResult;
  won: boolean;
};

type GameData = {
  steamAppId: number;
  title: string;
  headerImage: string;
  tags: string[];
  releaseYear: number | null;
  reviewPct: number | null;
  totalAchievements: number | null;
  avgPlayers24h: number | null;
  priceChfCents: number | null;
};

function numericStatus(
  guess: number | null,
  target: number | null,
  opts: { absolute?: number; percent?: number },
): NumericStatus {
  if (guess === null || target === null) return "unknown";
  if (guess === target) return "exact";
  const diff = Math.abs(guess - target);
  const isClose =
    opts.absolute != null
      ? diff <= opts.absolute
      : diff / Math.max(Math.abs(target), 1) <= (opts.percent ?? 0.2);
  const dir = target > guess ? "higher" : "lower";
  return isClose ? `close_${dir}` : dir;
}

function tagResult(guessedTags: string[], targetTags: string[]): TagResult {
  const targetSet = new Set(targetTags);
  const overlap = guessedTags.filter((t) => targetSet.has(t));
  const status =
    overlap.length === 0
      ? "none"
      : overlap.length >= targetTags.length * 0.8
      ? "exact"
      : "partial";
  return { value: guessedTags, overlap, status };
}

export function computeComparison(guess: GameData, target: GameData): GuessComparison {
  return {
    guessedAppId: guess.steamAppId,
    title: guess.title,
    headerImage: guess.headerImage,
    tags: tagResult(guess.tags, target.tags),
    releaseYear: {
      value: guess.releaseYear,
      status: numericStatus(guess.releaseYear, target.releaseYear, { absolute: 3 }),
    },
    reviewPct: {
      value: guess.reviewPct,
      status: numericStatus(guess.reviewPct, target.reviewPct, { absolute: 10 }),
    },
    totalAchievements: {
      value: guess.totalAchievements,
      status: numericStatus(guess.totalAchievements, target.totalAchievements, { percent: 0.25 }),
    },
    avgPlayers24h: {
      value: guess.avgPlayers24h,
      status: numericStatus(guess.avgPlayers24h, target.avgPlayers24h, { percent: 0.3 }),
    },
    priceChfCents: {
      value: guess.priceChfCents,
      status: numericStatus(guess.priceChfCents, target.priceChfCents, { absolute: 100 }),
    },
    won: guess.steamAppId === target.steamAppId,
  };
}
