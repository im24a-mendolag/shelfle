import { getServerSession } from "next-auth";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";

const searchGames = unstable_cache(
  async (targetUserId: string, q: string) =>
    db.game.findMany({
      where: {
        title: { [q.length === 1 ? "startsWith" : "contains"]: q, mode: "insensitive" },
        userGames: { some: { userId: targetUserId } },
        tags: { isEmpty: false },
        releaseYear: { not: null },
        reviewPct: { not: null },
        headerImage: { not: "" },
      },
      select: { steamAppId: true, title: true, headerImage: true },
      take: 10,
    }),
  ["game-search"],
  { revalidate: 60 },
);

export async function GET(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.length < 1) return NextResponse.json({ games: [] });

  // Single query: get user + their active round's targetUserId in one roundtrip
  const user = await db.user.findUnique({
    where: { steamId: session.user.steamId },
    select: {
      id: true,
      roundsPlayed: {
        where: { status: "active" },
        select: { targetUserId: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!user) return NextResponse.json({ games: [] });

  const searchUserId = user.roundsPlayed[0]?.targetUserId ?? user.id;
  const games = await searchGames(searchUserId, q);
  return NextResponse.json({ games });
}
