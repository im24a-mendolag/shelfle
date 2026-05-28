import { getServerSession } from "next-auth";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";

const searchGames = unstable_cache(
  async (targetUserId: string, q: string) =>
    db.game.findMany({
      where: {
        title: { contains: q, mode: "insensitive" },
        userGames: { some: { userId: targetUserId } },
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

  const user = await db.user.findUnique({ where: { steamId: session.user.steamId } });
  if (!user) return NextResponse.json({ games: [] });

  // In friend mode the active round has a different targetUserId — search that library
  const round = await db.round.findFirst({
    where: { playerUserId: user.id, status: "active" },
    select: { targetUserId: true },
    orderBy: { createdAt: "desc" },
  });
  const searchUserId = round?.targetUserId ?? user.id;

  const games = await searchGames(searchUserId, q);
  return NextResponse.json({ games });
}
