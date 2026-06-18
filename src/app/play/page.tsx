import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";
import { db } from "@/lib/db";
import GameClient from "@/components/game/GameClient";
import type { GuessComparison } from "@/lib/game/compare";

const MAX_GUESSES = 8;

async function pickEnrichedGame(userId: string) {
  const rows = await db.userGame.findMany({
    where: { userId },
    include: { game: { select: { steamAppId: true, title: true, headerImage: true, tags: true, releaseYear: true, reviewPct: true } } },
  });
  return rows.filter(
    (ug) => ug.game.tags.length > 0 && ug.game.releaseYear !== null && ug.game.reviewPct !== null && ug.game.headerImage !== "",
  );
}

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; friendName?: string; friendAvatar?: string }>;
}) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) redirect("/");

  const user = await syncUser(session.user.steamId, session.user.name ?? "");
  await syncLibrary(user.id, session.user.steamId);

  const { friend, friendName, friendAvatar } = await searchParams;

  // For solo: resume existing active round if present
  if (!friend) {
    const existing = await db.round.findFirst({
      where: { playerUserId: user.id, mode: "solo", status: "active" },
      include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const guesses = existing.guesses.map((g) => g.resultJson as GuessComparison);
      const won = guesses.some((g) => g.won);
      const lost = !won && guesses.length >= MAX_GUESSES;
      const finished = won || lost;
      return (
        <GameClient
          initialRound={{
            id: existing.id,
            status: existing.status as "active" | "won" | "lost",
            mode: "solo",
            guesses,
            maxGuesses: MAX_GUESSES,
            ...(finished ? { targetTitle: existing.game.title, targetHeaderImage: existing.game.headerImage } : {}),
          }}
        />
      );
    }
  }

  // Abandon any existing active rounds
  await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

  let targetUser = user;
  let mode: "solo" | "friend" = "solo";
  let resolvedFriendName = friendName;

  if (friend) {
    try {
      const friendSteamId = await resolveSteamId(friend);
      if (friendSteamId && friendSteamId !== session.user.steamId) {
        const { displayName } = await getSteamProfile(friendSteamId);
        targetUser = await syncUser(friendSteamId, displayName);
        await syncLibrary(targetUser.id, friendSteamId);
        revalidateTag("library");
        revalidateTag("game-search");
        mode = "friend";
        resolvedFriendName = displayName;
      }
    } catch {
      // fall through to solo on error
    }
  }

  const enriched = await pickEnrichedGame(targetUser.id);
  if (enriched.length === 0) {
    return <GameClient defaultFriend={friend} defaultFriendName={resolvedFriendName} defaultFriendAvatar={friendAvatar} />;
  }

  const pick = enriched[Math.floor(Math.random() * enriched.length)];
  const round = await db.round.create({
    data: { playerUserId: user.id, targetUserId: targetUser.id, targetAppId: pick.game.steamAppId, mode, status: "active" },
  });

  return (
    <GameClient
      initialRound={{ id: round.id, status: "active", mode, friendName: mode === "friend" ? targetUser.displayName : undefined, guesses: [], maxGuesses: MAX_GUESSES }}
      defaultFriend={friend}
      defaultFriendName={resolvedFriendName}
      defaultFriendAvatar={friendAvatar}
    />
  );
}
