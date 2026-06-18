import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile, getShortDescription } from "@/lib/steam/api";
import { db } from "@/lib/db";
import DescriptionClient from "@/components/game/DescriptionClient";
import type { InitRecord, GuessRecord } from "@/app/api/description/route";
import { buildRound, redactTitle } from "@/app/api/description/route";

export default async function DescriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; friendName?: string; friendAvatar?: string }>;
}) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) redirect("/");

  const user = await syncUser(session.user.steamId, session.user.name ?? "");
  await syncLibrary(user.id, session.user.steamId);

  const { friend, friendName, friendAvatar } = await searchParams;

  if (!friend) {
    const existing = await db.round.findFirst({
      where: { playerUserId: user.id, targetUserId: user.id, mode: "description", status: "active" },
      include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing && existing.guesses.length > 0) {
      const all = existing.guesses.map((g) => g.resultJson as InitRecord | GuessRecord);
      const init = all[0] as InitRecord;
      const realGuesses = all.slice(1) as GuessRecord[];
      return (
        <DescriptionClient
          initialRound={buildRound(existing.id, existing.status, init, realGuesses, existing.game.title, existing.game.headerImage)}
        />
      );
    }
  }

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
    return <DescriptionClient defaultFriend={friend} defaultFriendName={resolvedFriendName} defaultFriendAvatar={friendAvatar} />;
  }

  // Shuffle and find a game that has (or can fetch) a description
  const shuffled = candidates.sort(() => Math.random() - 0.5);
  let chosenGame: (typeof shuffled)[0] & { shortDescription: string } | null = null;
  for (const candidate of shuffled.slice(0, 10)) {
    if (candidate.shortDescription) {
      chosenGame = candidate as typeof chosenGame;
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
    return <DescriptionClient defaultFriend={friend} defaultFriendName={resolvedFriendName} defaultFriendAvatar={friendAvatar} />;
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

  await db.guess.create({ data: { roundId: round.id, guessedAppId: chosenGame.steamAppId, resultJson: init as object } });

  return (
    <DescriptionClient
      initialRound={buildRound(round.id, "active", init, [], chosenGame.title, chosenGame.headerImage, friend ? resolvedFriendName : undefined)}
      defaultFriend={friend}
      defaultFriendName={resolvedFriendName}
      defaultFriendAvatar={friendAvatar}
    />
  );
}
