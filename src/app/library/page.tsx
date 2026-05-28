import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getOwnedGames } from "@/lib/steam/api";
import { authCallbacks } from "@/lib/auth/config";
import UserHeader from "@/components/UserHeader";

export default async function LibraryPage() {
  const session = await getServerSession(authCallbacks);

  if (!session) redirect("/");

  const library = await getOwnedGames(session.user.steamId);

  const sorted = [...library.games].sort((a, b) => b.playtime_forever - a.playtime_forever);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-1">Your Library</h1>
            <p className="text-gray-400 text-sm">{library.game_count} games</p>
          </div>
          <UserHeader />
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left w-12"></th>
                <th className="px-4 py-3 text-left">Game</th>
                <th className="px-4 py-3 text-right">App ID</th>
                <th className="px-4 py-3 text-right">Playtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {sorted.map((game) => (
                <tr key={game.appid} className="hover:bg-gray-900 transition-colors">
                  <td className="px-4 py-2">
                    <div className="w-8 h-8 rounded overflow-hidden bg-gray-800 flex-shrink-0">
                      {game.img_icon_url && (
                        <img
                          src={`https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 font-medium">{game.name ?? `App ${game.appid}`}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{game.appid}</td>
                  <td className="px-4 py-2 text-right text-gray-300">
                    {game.playtime_forever === 0
                      ? "Never played"
                      : `${Math.round(game.playtime_forever / 60)} h`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
