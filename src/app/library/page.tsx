import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import Link from "next/link";

const PAGE_SIZE = 50;

function getLibraryGames(userId: string, page: number) {
  return db.userGame.findMany({
    where: {
      userId,
      game: {
        tags: { isEmpty: false },
        releaseYear: { not: null },
        NOT: { title: { startsWith: "App " } },
      },
    },
    include: { game: true },
    orderBy: { playtimeHours: "desc" },
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });
}

function ReviewBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-600">—</span>;
  const color = pct >= 75 ? "text-green-400" : pct >= 40 ? "text-yellow-400" : "text-red-400";
  return <span className={color}>{pct}%</span>;
}

function formatPrice(cents: number | null) {
  if (cents === null) return "—";
  if (cents === 0) return "Free";
  return `₣${(cents / 100).toFixed(2)}`;
}

function TableSkeleton() {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <div className="p-8 flex justify-center">
        <div className="w-full max-w-xs flex flex-col gap-3">
          <p className="text-sm text-gray-300 text-center">Loading library…</p>
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div className="h-2 bg-blue-500 rounded-full animate-pulse" style={{ width: "70%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

async function LibraryContent({
  friend,
  page,
  sessionSteamId,
  sessionName,
}: {
  friend?: string;
  page: number;
  sessionSteamId: string;
  sessionName: string;
}) {
  let viewUserId: string;
  let viewLabel: string;
  let viewAvatarUrl: string | null = null;
  let gameCount: number;
  let friendSteamIdResolved: string | null = null;

  if (friend) {
    friendSteamIdResolved = await resolveSteamId(friend);
    if (!friendSteamIdResolved) {
      return <p className="text-red-400 p-8">Could not resolve Steam ID. Check the URL and try again.</p>;
    }
    const { displayName, avatarUrl } = await getSteamProfile(friendSteamIdResolved);
    const friendUser = await syncUser(friendSteamIdResolved, displayName);
    gameCount = await syncLibrary(friendUser.id, friendSteamIdResolved);
    viewUserId = friendUser.id;
    viewLabel = `${friendUser.displayName}'s Library`;
    viewAvatarUrl = avatarUrl;
  } else {
    const user = await syncUser(sessionSteamId, sessionName);
    gameCount = await syncLibrary(user.id, sessionSteamId);
    viewUserId = user.id;
    viewLabel = "Your Library";
  }

  log.info("Library page rendered", { viewUserId, gameCount });

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (friend) params.set("friend", friend);
    if (p > 0) params.set("page", String(p));
    const qs = params.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  }

  const [raw, totalCount] = await Promise.all([
    getLibraryGames(viewUserId, page),
    db.userGame.count({
      where: {
        userId: viewUserId,
        game: {
          tags: { isEmpty: false },
          releaseYear: { not: null },
          NOT: { title: { startsWith: "App " } },
        },
      },
    }),
  ]);
  const hasNextPage = raw.length > PAGE_SIZE;
  const userGames = hasNextPage ? raw.slice(0, PAGE_SIZE) : raw;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          {viewAvatarUrl && (
            <img src={viewAvatarUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0" />
          )}
          <div>
            <h1 className="text-3xl font-bold mb-1">{viewLabel}</h1>
            <p className="text-gray-400 text-sm">{gameCount} games total</p>
          </div>
        </div>

        {friend && (
          <div className="flex gap-2 flex-shrink-0">
            <Link
              href={`/play?friend=${encodeURIComponent(friend)}`}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Play Classic
            </Link>
            <Link
              href={`/zoom?friend=${encodeURIComponent(friend)}`}
              className="bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Play Zoom
            </Link>
          </div>
        )}
      </div>

      {(page > 0 || hasNextPage) && (
        <div className="flex items-center justify-between mb-4">
          <Link
            href={pageUrl(page - 1)}
            className={`text-sm text-gray-400 hover:text-white transition-colors ${page === 0 ? "invisible" : ""}`}
          >
            ← Previous
          </Link>
          <span className="text-sm text-gray-500">{page + 1} / {totalPages}</span>
          <Link
            href={pageUrl(page + 1)}
            className={`text-sm text-gray-400 hover:text-white transition-colors ${!hasNextPage ? "invisible" : ""}`}
          >
            Next →
          </Link>
        </div>
      )}

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
                  <div className="w-16 h-8 rounded overflow-hidden bg-gray-900 flex-shrink-0">
                    {game.headerImage && (
                      <img src={game.headerImage} alt="" className="w-full h-full object-contain" />
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
                <td className="px-4 py-2 text-right text-gray-300">{game.releaseYear ?? "—"}</td>
                <td className="px-4 py-2 text-right"><ReviewBadge pct={game.reviewPct} /></td>
                <td className="px-4 py-2 text-right text-gray-300">
                  {game.totalAchievements !== null ? game.totalAchievements : "—"}
                </td>
                <td className="px-4 py-2 text-right text-gray-300">
                  {game.avgPlayers24h?.toLocaleString() ?? "—"}
                </td>
                <td className="px-4 py-2 text-right text-gray-300">
                  {formatPrice(game.priceChfCents)}
                </td>
                <td className="px-4 py-2 text-right text-gray-300">{`${playtimeHours} h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; page?: string }>;
}) {
  const session = await getServerSession(authCallbacks);
  if (!session) redirect("/");

  if (!session.user.steamId) {
    return (
      <main className="flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
        <p className="text-red-400">Session has no steamId — please sign out and sign back in.</p>
      </main>
    );
  }

  const { friend, page: pageParam } = await searchParams;
  const page = Math.max(0, parseInt(pageParam ?? "0", 10) || 0);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <Suspense fallback={<TableSkeleton />}>
        <LibraryContent
          friend={friend}
          page={page}
          sessionSteamId={session.user.steamId}
          sessionName={session.user.name ?? ""}
        />
      </Suspense>
    </main>
  );
}
