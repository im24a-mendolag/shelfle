import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamDisplayName } from "@/lib/steam/api";
import type { GuessComparison } from "@/lib/game/compare";

const MAX_GUESSES = 8;

async function pickEnrichedGame(userId: string) {
  const userGames = await db.userGame.findMany({
    where: { userId },
    include: {
      game: {
        select: {
          steamAppId: true,
          tags: true,
          releaseYear: true,
          reviewPct: true,
          headerImage: true,
        },
      },
    },
  });

  return userGames.filter(
    (ug) =>
      ug.game.tags.length > 0 &&
      ug.game.releaseYear !== null &&
      ug.game.reviewPct !== null &&
      ug.game.headerImage !== "",
  );
}

export async function GET() {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { steamId: session.user.steamId } });
  if (!user) return NextResponse.json({ round: null });

  const round = await db.round.findFirst({
    where: { playerUserId: user.id, status: { in: ["active", "won", "lost"] } },
    include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true, target: true },
    orderBy: { createdAt: "desc" },
  });

  if (!round) return NextResponse.json({ round: null });

  const guesses = round.guesses.map((g) => g.resultJson as GuessComparison);
  const won = guesses.some((g) => g.won);
  const lost = !won && guesses.length >= MAX_GUESSES;
  const finished = won || lost || round.status !== "active";

  return NextResponse.json({
    round: {
      id: round.id,
      status: round.status,
      mode: round.mode,
      friendName: round.mode === "friend" ? round.target.displayName : undefined,
      guesses,
      maxGuesses: MAX_GUESSES,
      ...(finished ? { targetTitle: round.game.title, targetHeaderImage: round.game.headerImage } : {}),
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
  let mode = "solo";

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
    const displayName = await getSteamDisplayName(friendSteamId);
    targetUser = await syncUser(friendSteamId, displayName);
    await syncLibrary(targetUser.id, friendSteamId);
    mode = "friend";
  }

  const enriched = await pickEnrichedGame(targetUser.id);
  if (enriched.length === 0) {
    return NextResponse.json(
      { error: mode === "friend" ? "Friend's library has no enriched games yet or their profile is private." : "No enriched games found. Visit your library page first." },
      { status: 400 },
    );
  }

  const pick = enriched[Math.floor(Math.random() * enriched.length)];

  const round = await db.round.create({
    data: {
      playerUserId: user.id,
      targetUserId: targetUser.id,
      targetAppId: pick.game.steamAppId,
      mode,
      status: "active",
    },
  });

  return NextResponse.json({
    round: {
      id: round.id,
      status: "active",
      mode,
      friendName: mode === "friend" ? targetUser.displayName : undefined,
      guesses: [],
      maxGuesses: MAX_GUESSES,
    },
  });
}
