export type InitRecord = {
  type: "init";
  shortDescription: string;
  firstLetter: string;
  releaseYear: number;
};

export type GuessRecord = {
  type: "guess";
  guessedAppId: number;
  title: string;
  headerImage: string;
  won: boolean;
};

export type DescriptionRound = {
  id: string;
  status: "active" | "won" | "lost";
  guesses: { guessedAppId: number; title: string; headerImage: string; won: boolean }[];
  maxGuesses: 3;
  shortDescription: string;
  firstLetter?: string;
  releaseYear?: number;
  targetTitle?: string;
  targetHeaderImage?: string;
  friendName?: string;
};

export function buildRound(
  roundId: string,
  status: string,
  init: InitRecord,
  realGuesses: GuessRecord[],
  targetTitle: string,
  targetHeaderImage: string,
  friendName?: string,
): DescriptionRound {
  const wrongCount = realGuesses.filter((g) => !g.won).length;
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
    maxGuesses: 3,
    shortDescription: init.shortDescription,
    releaseYear: wrongCount >= 1 || isOver ? init.releaseYear : undefined,
    firstLetter: wrongCount >= 2 || isOver ? init.firstLetter : undefined,
    targetTitle: isOver ? targetTitle : undefined,
    targetHeaderImage: isOver ? targetHeaderImage : undefined,
    friendName,
  };
}

export function redactTitle(description: string, title: string): string {
  const normalize = (s: string) => s.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
  const normalized = normalize(title);

  const variants = [normalized];
  const colonIdx = normalized.indexOf(":");
  if (colonIdx > 2) variants.push(normalized.slice(0, colonIdx).trim());
  if (/^the\s/i.test(normalized)) variants.push(normalized.replace(/^the\s+/i, ""));

  let result = description;
  for (const variant of variants) {
    if (variant.length < 3) continue;
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), (match) => "█".repeat(match.length));
  }
  return result;
}
