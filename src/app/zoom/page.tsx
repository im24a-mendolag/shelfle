import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";
import { db } from "@/lib/db";
import ZoomClient from "@/components/game/ZoomClient";

const MAX_GUESSES = 6;

type ZoomGuess = { guessedAppId: number; title: string; headerImage: string; won: boolean };

async function pickEnrichedGame(userId: string) {
  const rows = await db.userGame.findMany({
    where: { userId },
    include: { game: { select: { steamAppId: true, headerImage: true, tags: true, releaseYear: true, reviewPct: true } } },
  });
  return rows.filter(
    (ug) => ug.game.headerImage !== "" && ug.game.tags.length > 0 && ug.game.releaseYear !== null && ug.game.reviewPct !== null,
  );
}

export default async function ZoomPage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; friendName?: string; friendAvatar?: string; challenge?: string }>;
}) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) redirect("/");

  const user = await syncUser(session.user.steamId, session.user.name ?? "");
  await syncLibrary(user.id, session.user.steamId);

  const { friend, friendName, friendAvatar, challenge } = await searchParams;

  // ── Challenge mode ────────────────────────────────────────────────────────
  if (challenge) {
    const chal = await db.challenge.findUnique({ where: { id: challenge } });
    if (!chal || chal.mode !== "zoom" || !chal.gameAppId || chal.expiresAt < new Date()) redirect("/");
    const alreadyPlayed = await db.round.findFirst({ where: { playerUserId: user.id, challengeId: chal.id } });
    if (alreadyPlayed) redirect(`/challenge/${challenge}/results`);

    await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

    const forcedGame = await db.game.findUnique({ where: { steamAppId: chal.gameAppId } });
    if (!forcedGame) redirect("/");

    const round = await db.round.create({
      data: { playerUserId: user.id, targetUserId: chal.targetUserId, targetAppId: chal.gameAppId, mode: "zoom", status: "active", challengeId: chal.id },
    });
    return (
      <ZoomClient
        challengeId={chal.id}
        initialRound={{ id: round.id, status: "active", guesses: [], maxGuesses: MAX_GUESSES, targetHeaderImage: forcedGame.headerImage }}
      />
    );
  }

  // ── Normal mode ───────────────────────────────────────────────────────────

  // For solo: resume existing active round if present
  if (!friend) {
    const existing = await db.round.findFirst({
      where: { playerUserId: user.id, targetUserId: user.id, mode: "zoom", status: "active" },
      include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const guesses = existing.guesses.map((g) => g.resultJson as ZoomGuess);
      return (
        <ZoomClient
          challengeId={existing.challengeId ?? undefined}
          initialRound={{
            id: existing.id,
            status: existing.status as "active" | "won" | "lost",
            guesses,
            maxGuesses: MAX_GUESSES,
            targetHeaderImage: existing.game.headerImage,
          }}
        />
      );
    }
  }

  // Abandon any existing active rounds
  await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

  let targetUser = user;
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
        resolvedFriendName = displayName;
      }
    } catch {
      // fall through to solo on error
    }
  }

  const enriched = await pickEnrichedGame(targetUser.id);
  if (enriched.length === 0) {
    return <ZoomClient defaultFriend={friend} defaultFriendName={resolvedFriendName} defaultFriendAvatar={friendAvatar} />;
  }

  const pick = enriched[Math.floor(Math.random() * enriched.length)];
  const round = await db.round.create({
    data: { playerUserId: user.id, targetUserId: targetUser.id, targetAppId: pick.game.steamAppId, mode: "zoom", status: "active" },
  });

  return (
    <ZoomClient
      initialRound={{ id: round.id, status: "active", guesses: [], maxGuesses: MAX_GUESSES, targetHeaderImage: pick.game.headerImage, friendName: friend ? resolvedFriendName : undefined }}
      defaultFriend={friend}
      defaultFriendName={resolvedFriendName}
      defaultFriendAvatar={friendAvatar}
    />
  );
}
