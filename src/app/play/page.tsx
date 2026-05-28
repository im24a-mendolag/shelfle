import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import GameClient from "@/components/game/GameClient";

export default async function PlayPage() {
  const session = await getServerSession(authCallbacks);
  if (!session) redirect("/");

  if (session.user.steamId) {
    const user = await syncUser(session.user.steamId, session.user.name ?? "");
    await syncLibrary(user.id, session.user.steamId);
  }

  return <GameClient />;
}
