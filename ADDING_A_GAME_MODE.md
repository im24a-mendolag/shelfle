# Adding a New Game Mode

## 1. Register it in `src/lib/gameModes.ts`

This is the single source of truth. Adding an entry here automatically adds it to the navbar, the friends "Play" dropdown, and the home page card.

```ts
export const GAME_MODES = [
  // ... existing modes
  {
    label: "YourMode",
    path: "/yourmode",
    description: "One-line description shown on the home page card",
    accent: false,   // true = blue card (only Classic uses this)
  },
] as const;
```

If your mode has a dynamic stat in the home page card footer (e.g. "42 games ready"), add it to the `footerText` map in `src/app/page.tsx`:

```ts
const footerText: Record<string, string> = {
  "/play": `${enrichedCount.toLocaleString()} games ready`,
  "/yourmode": `some dynamic value`,
};
```

---

## 2. Server page — `src/app/yourmode/page.tsx`

The server page is responsible for creating the initial round so the client mounts with data ready (no client-side loading bar on first load). Copy the pattern from `src/app/zoom/page.tsx`.

```ts
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import { resolveSteamId, getSteamProfile } from "@/lib/steam/api";
import { db } from "@/lib/db";
import YourModeClient from "@/components/game/YourModeClient";

export default async function YourModePage({
  searchParams,
}: {
  searchParams: Promise<{ friend?: string; friendName?: string; friendAvatar?: string; challenge?: string }>;
}) {
  const session = await getServerSession(authCallbacks);
  if (!session?.user.steamId) redirect("/");

  const user = await syncUser(session.user.steamId, session.user.name ?? "");
  await syncLibrary(user.id, session.user.steamId);

  const { friend, friendName, friendAvatar, challenge } = await searchParams;

  // ── Challenge mode ──────────────────────────────────────────────────────
  if (challenge) {
    const chal = await db.challenge.findUnique({ where: { id: challenge } });
    // validate: exists, correct mode, has a forced game, not expired
    if (!chal || chal.mode !== "yourmode" || !chal.gameAppId || chal.expiresAt < new Date()) redirect("/");
    // if already played, go straight to results
    const alreadyPlayed = await db.round.findFirst({ where: { playerUserId: user.id, challengeId: chal.id } });
    if (alreadyPlayed) redirect(`/challenge/${challenge}/results`);

    await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

    const forcedGame = await db.game.findUnique({ where: { steamAppId: chal.gameAppId } });
    if (!forcedGame) redirect("/");

    const round = await db.round.create({
      data: { playerUserId: user.id, targetUserId: chal.targetUserId, targetAppId: chal.gameAppId, mode: "yourmode", status: "active", challengeId: chal.id },
    });
    return (
      <YourModeClient
        challengeId={chal.id}
        initialRound={{ id: round.id, status: "active", /* ...mode-specific fields */ }}
      />
    );
  }

  // ── Normal mode ─────────────────────────────────────────────────────────

  // For solo: resume existing active round if present
  if (!friend) {
    const existing = await db.round.findFirst({
      where: { playerUserId: user.id, targetUserId: user.id, mode: "yourmode", status: "active" },
      include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      // reconstruct your round shape from existing.guesses and pass as initialRound
      // pass challengeId so the client shows "View Results" if this was a challenge round
      return <YourModeClient challengeId={existing.challengeId ?? undefined} initialRound={{ /* ... */ }} />;
    }
  }

  // Abandon existing active rounds and create a new one
  await db.round.updateMany({ where: { playerUserId: user.id, status: "active" }, data: { status: "abandoned" } });

  let targetUser = user;
  let resolvedFriendName = friendName;
  if (friend) {
    try {
      const friendSteamId = await resolveSteamId(friend);
      if (friendSteamId && friendSteamId !== session.user.steamId) {
        const { displayName } = await getSteamProfile(friendSteamId);
        targetUser = await syncUser(friendSteamId, displayName);
        await syncLibrary(targetUser.id, friendSteamId);
        revalidateTag("library");
        revalidateTag("game-search");
        resolvedFriendName = displayName;
      }
    } catch { /* fall through to solo */ }
  }

  // pick a game, create round, pass initialRound to client
  // ...

  return (
    <YourModeClient
      initialRound={{ /* ... */ }}
      defaultFriend={friend}
      defaultFriendName={resolvedFriendName}
      defaultFriendAvatar={friendAvatar}
    />
  );
}
```

No `loading.tsx` needed — `src/app/loading.tsx` at the root covers all mode pages automatically.

---

## 3. API routes

### `src/app/api/yourmode/route.ts`

**GET** — restore an active round so the player can continue after a page refresh:

```ts
const round = await db.round.findFirst({
  where: { playerUserId: user.id, mode: "yourmode", status: "active" },
  include: { guesses: { orderBy: { guessedAt: "asc" } }, game: true, target: true },
  orderBy: { createdAt: "desc" },
});
```

**POST** — start a new round:

1. Abandon all active rounds:
   ```ts
   await db.round.updateMany({
     where: { playerUserId: user.id, status: "active" },
     data: { status: "abandoned" },
   });
   ```
2. Handle optional `friendSteamId` in the request body (use `resolveSteamId` + `getSteamProfile` + `syncUser` + `syncLibrary` — see any existing mode for the full pattern).
3. Pick a game from the pool:
   ```ts
   // Minimum eligibility filter (used by all modes):
   game.tags.length > 0 && game.releaseYear !== null && game.reviewPct !== null && game.headerImage !== ""
   ```
4. Create the round:
   ```ts
   const round = await db.round.create({
     data: { playerUserId: user.id, targetUserId: targetUser.id, targetAppId: game.steamAppId, mode: "yourmode", status: "active" },
   });
   ```
5. Store any mode-specific setup data as the first `Guess` record using `resultJson` (see HigherLower's `InitRecord` pattern in `src/app/api/higherlower/route.ts`).
6. Return a typed round shape to the client.

### `src/app/api/yourmode/guess/route.ts`

```ts
// Always filter by mode to avoid cross-mode interference
const round = await db.round.findFirst({
  where: { playerUserId: user.id, mode: "yourmode", status: "active" },
  include: { guesses: true, game: true },
  orderBy: { createdAt: "desc" },
});

// Validate: round exists, max guesses not exceeded, no duplicate guess

// Create the Guess record
await db.guess.create({
  data: { roundId: round.id, guessedAppId, resultJson: { ... } },
});

// Update round status on win or loss
if (won || lost) {
  await db.round.update({ where: { id: round.id }, data: { status: won ? "won" : "lost" } });
}
```

---

## 4. Client component — `src/components/game/YourModeClient.tsx`

Use `ZoomClient` (`src/components/game/ZoomClient.tsx`) as the template — it's the simplest.

Key points:
- `"use client"` at the top
- Accepts `initialRound?: YourRoundType` — if provided, skip all initial fetching and render game immediately:
  ```ts
  const [round, setRound] = useState<YourRoundType | null>(initialRound ?? null);
  const [loading, setLoading] = useState(!initialRound);

  useEffect(() => {
    if (initialRound) return; // server already created the round
    // fallback: fetch("/api/yourmode") to restore, else startGame()
  }, []);
  ```
- `startGame()` POSTs to `/api/yourmode` and shows a `<LoadingBar>` — only runs on "Play Again", not initial load
- `submitGuess(game)` POSTs to `/api/yourmode/guess`
- Search uses the shared endpoint: `GET /api/game/search?q=`
- No page header — the `<Navbar>` is injected by `layout.tsx`

### Challenge support in the client

Accept a `challengeId?: string` prop. When the round ends, use it to decide what to render:

```tsx
export default function YourModeClient({
  initialRound,
  challengeId,
  // ...
}: {
  initialRound?: YourRoundType;
  challengeId?: string;
  // ...
}) {
  const [challengeLink, setChallengeLink] = useState("");

  async function createChallenge() {
    const r = await fetch("/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId: round.id }),
    });
    const d = await r.json();
    if (d.challengeId) setChallengeLink(`${window.location.origin}/challenge/${d.challengeId}`);
  }

  // In the post-round UI:
  return challengeId ? (
    // Opponent view: go see results
    <a href={`/challenge/${challengeId}/results`}>View Challenge Results</a>
  ) : (
    // Creator view: play again + create challenge
    <>
      <button onClick={startGame}>Play Again</button>
      {!challengeLink
        ? <button onClick={createChallenge}>Challenge a Friend</button>
        : <CopyRow url={challengeLink} />
      }
    </>
  );
}
```

---

## 5. No database changes needed

`Round.mode` is a plain varchar — just use your new mode string (e.g. `"yourmode"`).
`Guess.resultJson` is untyped JSONB — store whatever shape your mode needs.

---

## Checklist

- [ ] Entry added to `src/lib/gameModes.ts`
- [ ] `src/app/yourmode/page.tsx` — syncs library, handles `?challenge=` param, creates initial round server-side
- [ ] `src/app/api/yourmode/route.ts` (POST only needed for "Play Again"; GET optional)
- [ ] `src/app/api/yourmode/guess/route.ts` (POST)
- [ ] `src/components/game/YourModeClient.tsx` — accepts `initialRound` and `challengeId` props; renders "View Results" or "Challenge a Friend" after round ends
- [ ] Optional: footer stat in `footerText` map in `src/app/page.tsx`
- [ ] Update `CONTEXT.md` — add the new mode to the project structure tree and document any new utilities, API routes, or patterns it introduces
