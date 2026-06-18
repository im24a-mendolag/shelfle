import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile, getShortDescription } from "@/lib/steam/api";

export function redactTitle(description: string, title: string): string {
  const normalize = (s: string) => s.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
  const normalized = normalize(title);

  const variants = [normalized];
  // Also try without subtitle (e.g. "Game Name: Subtitle" → "Game Name")
  const colonIdx = normalized.indexOf(":");
  if (colonIdx > 2) variants.push(normalized.slice(0, colonIdx).trim());
  // Also try without leading "The "
  if (/^the\s/i.test(normalized)) variants.push(normalized.replace(/^the\s+/i, ""));

  let result = description;
  for (const variant of variants) {
    if (variant.length < 3) continue;
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), (match) => "█".repeat(match.length));
  }
  return result;
}

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

export async function GET() {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { steamId: session.user.steamId } });
  if (!user) return NextResponse.json({ round: null });

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, mode: "description", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true, target: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ round: null });

  const all = round.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
  const init = all[0] as InitRecord;
  const realGuesses = all.slice(1) as GuessRecord[];
  const isFriend = round.targetUserId !== user.id;

  return NextResponse.json({
    round: buildRound(
      round.id,
      round.status,
      init,
      realGuesses,
      round.game.title,
      round.game.headerImage,
      isFriend ? round.target.displayName : undefined,
    ),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await syncUser(session.user.steamId, session.user.name ?? "");

  await db.round.updateMany({
    where: { playerUserId: user.id, status: "active" },
    data: { status: "abandoned" },
  });

  const body = await req.json().catch(() => ({}));
  const friendInput: string | undefined = body.friendSteamId;
  let targetUser = user;

  if (friendInput) {
    const friendSteamId = await resolveSteamId(friendInput);
    if (!friendSteamId) {
      return NextResponse.json(
        { error: "Could not resolve Steam ID. Try a 17-digit Steam ID, profile URL, or vanity name." },
        { status: 400 },
      );
    }
    if (friendSteamId === session.user.steamId) {
      return NextResponse.json({ error: "That's your own profile — use Solo mode." }, { status: 400 });
    }
    const { displayName } = await getSteamProfile(friendSteamId);
    targetUser = await syncUser(friendSteamId, displayName);
    try {
      await syncLibrary(targetUser.id, friendSteamId);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to sync friend's library. Their profile may be private." },
        { status: 400 },
      );
    }
    revalidateTag("game-search");
    revalidateTag("library");
  }

  const rows = await db.userGame.findMany({
    where: { userId: targetUser.id },
    include: {
      game: {
        select: {
          steamAppId: true,
          title: true,
          headerImage: true,
          tags: true,
          releaseYear: true,
          reviewPct: true,
          shortDescription: true,
        },
      },
    },
  });

  const candidates = rows
    .filter(
      (ug) =>
        ug.game.headerImage !== "" &&
        ug.game.tags.length > 0 &&
        ug.game.releaseYear !== null,
    )
    .map((ug) => ug.game);

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: friendInput ? "Friend's library has no eligible games yet." : "No eligible games found. Visit your library page to sync your library first." },
      { status: 400 },
    );
  }

  // Shuffle and find a game with a description (fetch on-demand if needed)
  const shuffled = candidates.sort(() => Math.random() - 0.5);
  type Candidate = (typeof shuffled)[0];
  let chosenGame: (Candidate & { shortDescription: string }) | null = null;
  for (const candidate of shuffled.slice(0, 10)) {
    if (candidate.shortDescription) {
      chosenGame = candidate as Candidate & { shortDescription: string };
      break;
    }
    const desc = await getShortDescription(candidate.steamAppId);
    if (desc) {
      await db.game.update({ where: { steamAppId: candidate.steamAppId }, data: { shortDescription: desc } });
      chosenGame = { ...candidate, shortDescription: desc };
      break;
    }
  }

  if (!chosenGame) {
    return NextResponse.json(
      { error: "Could not load a description for any game. Try again in a moment." },
      { status: 400 },
    );
  }

  const round = await db.round.create({
    data: {
      playerUserId: user.id,
      targetUserId: targetUser.id,
      targetAppId: chosenGame.steamAppId,
      mode: "description",
      status: "active",
    },
  });

  const init: InitRecord = {
    type: "init",
    shortDescription: redactTitle(chosenGame.shortDescription!, chosenGame.title),
    firstLetter: chosenGame.title.replace(/[™®©]/g, "").trim().charAt(0).toUpperCase(),
    releaseYear: chosenGame.releaseYear!,
  };

  await db.guess.create({
    data: { roundId: round.id, guessedAppId: chosenGame.steamAppId, resultJson: init as object },
  });

  return NextResponse.json({
    round: buildRound(
      round.id,
      "active",
      init,
      [],
      chosenGame.title,
      chosenGame.headerImage,
      friendInput ? targetUser.displayName : undefined,
    ),
  });
}
