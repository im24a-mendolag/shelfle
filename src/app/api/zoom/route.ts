import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";

const MAX_GUESSES = 6;

type ZoomGuess = { guessedAppId: number; title: string; headerImage: string; won: boolean };

async function pickEnrichedGame(userId: string) {
  const userGames = await db.userGame.findMany({
    where: { userId },
    include: {
      game: {
        select: { steamAppId: true, headerImage: true, tags: true, releaseYear: true, reviewPct: true },
      },
    },
  });
  return userGames.filter(
    (ug) =>
      ug.game.headerImage !== "" &&
      ug.game.tags.length > 0 &&
      ug.game.releaseYear !== null &&
      ug.game.reviewPct !== null,
  );
}

export async function GET() {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { steamId: session.user.steamId } });
  if (!user) return NextResponse.json({ round: null });

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, mode: "zoom", status: "active" },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true, target: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ round: null });

  const guesses = round.guesses.map((g) => g.resultJson as ZoomGuess);
  const isFriend = round.targetUserId !== user.id;

  return NextResponse.json({
    round: {
      id: round.id,
      status: round.status,
      guesses,
      maxGuesses: MAX_GUESSES,
      targetHeaderImage: round.game.headerImage,
      friendName: isFriend ? round.target.displayName : undefined,
    },
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

  const enriched = await pickEnrichedGame(targetUser.id);
  if (enriched.length === 0) {
    return NextResponse.json(
      {
        error: friendInput
          ? "Friend's library has no enriched games yet or their profile is private."
          : "No enriched games found. Visit your library page first.",
      },
      { status: 400 },
    );
  }

  const pick = enriched[Math.floor(Math.random() * enriched.length)];

  const round = await db.round.create({
    data: {
      playerUserId: user.id,
      targetUserId: targetUser.id,
      targetAppId: pick.game.steamAppId,
      mode: "zoom",
      status: "active",
    },
  });

  return NextResponse.json({
    round: {
      id: round.id,
      status: "active",
      guesses: [],
      maxGuesses: MAX_GUESSES,
      targetHeaderImage: pick.game.headerImage,
      friendName: friendInput ? targetUser.displayName : undefined,
    },
  });
}
