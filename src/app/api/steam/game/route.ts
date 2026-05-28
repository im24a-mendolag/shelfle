import { NextRequest, NextResponse } from "next/server";
import { getAppDetails, getSteamSpyInfo, mergeGameInfo } from "@/lib/steam/api";

export async function GET(req: NextRequest) {
  const appIdParam = req.nextUrl.searchParams.get("appId");

  if (!appIdParam) {
    return NextResponse.json(
      { error: "Missing required query param: appId" },
      { status: 400 }
    );
  }

  const appId = parseInt(appIdParam, 10);
  if (isNaN(appId)) {
    return NextResponse.json({ error: "appId must be a number" }, { status: 400 });
  }

  const [details, spy] = await Promise.all([
    getAppDetails(appId),
    getSteamSpyInfo(appId),
  ]);

  if (!details && !spy) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

  const game = mergeGameInfo(appId, 0, details, spy);
  return NextResponse.json(game);
}
