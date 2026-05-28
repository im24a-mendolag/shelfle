import { getServerSession } from "next-auth";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import Link from "next/link";
import UserHeader from "@/components/UserHeader";
import CurrencySelector from "@/components/CurrencySelector";

const getLibraryGames = unstable_cache(
  (userId: string) =>
    db.userGame.findMany({
      where: { userId },
      include: { game: true },
      orderBy: { playtimeHours: "desc" },
      take: 30,
    }),
  ["library-games"],
  { revalidate: 300, tags: ["library"] },
);

function ReviewBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-600">—</span>;
  const color = pct >= 75 ? "text-green-400" : pct >= 40 ? "text-yellow-400" : "text-red-400";
  return <span className={color}>{pct}%</span>;
}

const CURRENCY_FORMAT: Record<string, { field: "priceUsdCents" | "priceEurCents" | "priceChfCents"; symbol: string }> = {
  usd: { field: "priceUsdCents", symbol: "$" },
  eur: { field: "priceEurCents", symbol: "€" },
  chf: { field: "priceChfCents", symbol: "₣" },
};

function formatPrice(cents: number | null, symbol: string) {
  if (cents === null) return "—";
  if (cents === 0) return "Free";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const { currency = "chf" } = await searchParams;
  const currencyConfig = CURRENCY_FORMAT[currency] ?? CURRENCY_FORMAT.eur;
  const session = await getServerSession(authCallbacks);
  if (!session) redirect("/");

  if (!session.user.steamId) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-red-400">Session has no steamId — please sign out and sign back in.</p>
      </main>
    );
  }

  // Upsert user record then sync library (skipped if done within 1 h)
  const user = await syncUser(session.user.steamId, session.user.name ?? "");
  const gameCount = await syncLibrary(user.id, session.user.steamId);

  log.info("Library page rendered", { steamId: session.user.steamId, gameCount });

  const userGames = await getLibraryGames(user.id);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-1">Your Library</h1>
            <p className="text-gray-400 text-sm">{gameCount} games total · showing top 30 by playtime</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/play" className="text-sm text-gray-400 hover:text-white transition-colors">
              Play →
            </Link>
            <CurrencySelector current={currency} />
            <UserHeader />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-900 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left w-10"></th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Tags</th>
                <th className="px-4 py-3 text-right">Year</th>
                <th className="px-4 py-3 text-right">Review</th>
                <th className="px-4 py-3 text-right">Achievements</th>
                <th className="px-4 py-3 text-right">Avg Players 24h</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Playtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {userGames.map(({ game, playtimeHours }) => (
                <tr key={game.steamAppId} className="hover:bg-gray-900 transition-colors">
                  <td className="px-4 py-2">
                    <div className="w-8 h-8 rounded overflow-hidden bg-gray-800 flex-shrink-0">
                      {game.headerImage && (
                        <img
                          src={game.headerImage}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 font-medium max-w-[200px] truncate">{game.title}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1 flex-wrap max-w-[260px]">
                      {game.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300">
                    {game.releaseYear ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <ReviewBadge pct={game.reviewPct} />
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300">
                    {game.totalAchievements !== null ? game.totalAchievements : "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300">
                    {game.avgPlayers24h?.toLocaleString() ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300">
                    {formatPrice(game[currencyConfig.field], currencyConfig.symbol)}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300">
                    {playtimeHours === 0 ? "—" : `${playtimeHours} h`}
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
