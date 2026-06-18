import { getServerSession } from "next-auth";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser } from "@/lib/steam/sync";
import { getSteamFriends } from "@/lib/steam/api";
import { db } from "@/lib/db";
import Link from "next/link";
import { GAME_MODES } from "@/lib/gameModes";
import SteamLoginButton from "@/components/SteamLoginButton";
import FriendLibraryInput from "@/components/FriendLibraryInput";
import FriendsList from "@/components/FriendsList";

export default async function Home() {
  const session = await getServerSession(authCallbacks);

  if (!session?.user.steamId) {
    return (
      <main className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] gap-6">
        <h1 className="text-5xl font-bold tracking-tight">Shelfle</h1>
        <p className="text-gray-400">Guess the game. Off any shelf.</p>
        <SteamLoginButton />
      </main>
    );
  }

  const user = await syncUser(session.user.steamId, session.user.name ?? "");

  const [enrichedCount, gameCount, stats, friends] = await Promise.all([
    db.game.count({
      where: {
        userGames: { some: { userId: user.id } },
        tags: { isEmpty: false },
        releaseYear: { not: null },
        reviewPct: { not: null },
      },
    }),
    db.userGame.count({ where: { userId: user.id } }),
    db.stats.findUnique({ where: { userId: user.id } }),
    getSteamFriends(session.user.steamId),
  ]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">

      {/* Stats row */}
      {stats && (stats.roundsPlayed > 0) && (
        <div className="flex items-center gap-6 mb-8 text-sm text-gray-400">
          <span><span className="text-white font-medium">{stats.roundsPlayed}</span> played</span>
          <span><span className="text-white font-medium">{stats.roundsWon}</span> won</span>
          {stats.currentStreak > 0 && (
            <span className="text-orange-400 font-medium">🔥 {stats.currentStreak} streak</span>
          )}
          {stats.bestStreak > 1 && (
            <span><span className="text-white font-medium">{stats.bestStreak}</span> best streak</span>
          )}
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-10">

        {/* Left: Mode cards */}
        <div className="flex-1 min-w-0">
          {(() => {
            const footerText: Record<string, string> = {
              "/play": `${enrichedCount.toLocaleString()} games ready`,
              "/zoom": `${gameCount.toLocaleString()} games in your library`,
            };
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {GAME_MODES.map((mode) => (
                  <Link
                    key={mode.path}
                    href={mode.path}
                    className={`group flex flex-col gap-2 rounded-2xl px-6 py-8 transition-colors ${
                      mode.accent
                        ? "bg-blue-600 hover:bg-blue-500"
                        : "bg-gray-900 border border-gray-800 hover:border-gray-600"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold">{mode.label}</h2>
                      <span className={`text-2xl transition-transform ${mode.accent ? "text-blue-200 group-hover:translate-x-1" : "text-gray-500 group-hover:text-white"}`}>→</span>
                    </div>
                    <p className={`text-sm ${mode.accent ? "text-blue-200" : "text-gray-400"}`}>
                      {mode.description}
                    </p>
                    {footerText[mode.path] && (
                      <p className={`text-xs mt-auto pt-2 border-t ${mode.accent ? "text-blue-300 border-blue-500" : "text-gray-600 border-gray-800"}`}>
                        {footerText[mode.path]}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Right: Friends section */}
        <div className="w-full lg:w-[420px] lg:flex-none">
          <section>
            <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-3">
              {friends.length > 0 ? `Friends (${friends.length})` : "Play a friend's library"}
            </h3>
            {friends.length > 0 ? (
              <>
                <FriendsList friends={friends} />
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <p className="text-gray-500 text-xs mb-2">Or enter a Steam ID / URL directly</p>
                  <FriendLibraryInput mode="both" />
                </div>
              </>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
                <p className="text-gray-400 text-sm mb-3">Enter a Steam ID, vanity URL, or profile URL.</p>
                <FriendLibraryInput mode="both" />
              </div>
            )}
          </section>
        </div>

      </div>
    </main>
  );
}
