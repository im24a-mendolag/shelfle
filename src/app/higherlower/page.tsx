import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import HigherLowerClient from "@/components/game/HigherLowerClient";

export default async function HigherLowerPage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; friendName?: string; friendAvatar?: string }>;
}) {
  const session = await getServerSession(authCallbacks);
  if (!session) redirect("/");

  if (session.user.steamId) {
    const user = await syncUser(session.user.steamId, session.user.name ?? "");
    await syncLibrary(user.id, session.user.steamId);
  }

  const { friend, friendName, friendAvatar } = await searchParams;
  return <HigherLowerClient defaultFriend={friend} defaultFriendName={friendName} defaultFriendAvatar={friendAvatar} />;
}
