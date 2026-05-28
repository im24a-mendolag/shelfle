import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authCallbacks } from "@/lib/auth/config";
import SteamLoginButton from "@/components/SteamLoginButton";

export default async function Home() {
  const session = await getServerSession(authCallbacks);
  if (session) redirect("/library");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white gap-6">
      <h1 className="text-5xl font-bold tracking-tight">Shelfle</h1>
      <p className="text-gray-400">Guess the game. Off any shelf.</p>
      <SteamLoginButton />
    </main>
  );
}
