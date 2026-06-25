import type { InitRecord, GuessRecord, AchievementRound } from "@/app/api/achievement/route";

export function buildRound(
  roundId: string,
  status: string,
  init: InitRecord,
  realGuesses: GuessRecord[],
  targetTitle: string,
  targetHeaderImage: string,
  friendName?: string,
  challengeId?: string,
): AchievementRound {
  const wrongCount = realGuesses.filter((g) => !g.won).length;
  const clueLevel: 0 | 1 | 2 | 3 = wrongCount >= 4 ? 3 : wrongCount >= 3 ? 2 : wrongCount >= 2 ? 1 : 0;
  const isOver = status === "won" || status === "lost";
  return {
    id: roundId,
    status: status as "active" | "won" | "lost",
    guesses: realGuesses.map((g) => ({ guessedAppId: g.guessedAppId, title: g.title, headerImage: g.headerImage, won: g.won })),
    maxGuesses: 5,
    clueLevel,
    achievementName: init.achievementName,
    achievementIconUrl: clueLevel >= 1 || isOver ? init.achievementIconUrl : undefined,
    achievementPercent: clueLevel >= 2 || isOver ? init.achievementPercent : undefined,
    achievementDescription: clueLevel >= 3 || isOver ? init.achievementDescription : undefined,
    targetTitle: isOver ? targetTitle : undefined,
    targetHeaderImage: isOver ? targetHeaderImage : undefined,
    friendName,
    challengeId,
  };
}
