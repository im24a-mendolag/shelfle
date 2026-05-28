import { NextRequest, NextResponse } from "next/server";
import { getOwnedGames } from "@/lib/steam/api";

export async function GET(req: NextRequest) {
  const steamId = req.nextUrl.searchParams.get("steamId");

  if (!steamId) {
    return NextResponse.json(
      { error: "Missing required query param: steamId" },
      { status: 400 }
    );
  }

  if (!process.env.STEAM_API_KEY) {
    return NextResponse.json(
      { error: "STEAM_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  try {
    const library = await getOwnedGames(steamId);
    return NextResponse.json({
      game_count: library.game_count,
      games: library.games,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
