import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authCallbacks } from "@/lib/auth/config";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user, body] = await Promise.all([
    db.user.findUnique({ where: { steamId: session.user.steamId } }),
    req.json(),
  ]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roundId: string = body.roundId;
  if (!roundId) return NextResponse.json({ error: "Missing roundId" }, { status: 400 });

  const round = await db.round.findFirst({
    where: { id: roundId, playerUserId: user.id, status: { in: ["won", "lost"] } },
  });
  if (!round) return NextResponse.json({ error: "Round not found or still active" }, { status: 404 });

  // If this round already belongs to a challenge, return that challenge
  if (round.challengeId) {
    return NextResponse.json({ challengeId: round.challengeId });
  }

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const challenge = await db.challenge.create({
    data: {
      mode: round.mode,
      gameAppId: round.mode !== "higherlower" ? round.targetAppId : null,
      targetUserId: round.targetUserId,
      creatorId: user.id,
      status: "pending",
      expiresAt,
    },
  });

  // Link the creator's round to the challenge
  await db.round.update({
    where: { id: round.id },
    data: { challengeId: challenge.id },
  });

  return NextResponse.json({ challengeId: challenge.id });
}
