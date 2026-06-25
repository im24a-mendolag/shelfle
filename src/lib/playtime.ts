import type { InitRecord, GuessRecord, PlaytimeRound } from "@/app/api/playtime/route";

export const MAX_GUESSES = 3;

export function buildRound(
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
