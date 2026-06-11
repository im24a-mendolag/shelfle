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

Copy from any existing mode (e.g. `src/app/zoom/page.tsx`). Change the client import.

```ts
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authCallbacks } from "@/lib/auth/config";
import { syncUser, syncLibrary } from "@/lib/steam/sync";
import YourModeClient from "@/components/game/YourModeClient";

export default async function YourModePage({
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
  return <YourModeClient defaultFriend={friend} defaultFriendName={friendName} defaultFriendAvatar={friendAvatar} />;
}
```

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
- On mount: `fetch("/api/yourmode")` to restore an active round; if none → call `startGame()`
- `startGame()` POSTs to `/api/yourmode` and shows a `<LoadingBar>` with staged progress labels
- `submitGuess(game)` POSTs to `/api/yourmode/guess`
- Search uses the shared endpoint: `GET /api/game/search?q=`
- No page header — the `<Navbar>` is injected by `layout.tsx`

---

## 5. No database changes needed

`Round.mode` is a plain varchar — just use your new mode string (e.g. `"yourmode"`).
`Guess.resultJson` is untyped JSONB — store whatever shape your mode needs.

---

## Checklist

- [ ] Entry added to `src/lib/gameModes.ts`
- [ ] `src/app/yourmode/page.tsx`
- [ ] `src/app/api/yourmode/route.ts` (GET + POST)
- [ ] `src/app/api/yourmode/guess/route.ts` (POST)
- [ ] `src/components/game/YourModeClient.tsx`
- [ ] Optional: footer stat in `footerText` map in `src/app/page.tsx`
- [ ] Update `CONTEXT.md` — add the new mode to the project structure tree and document any new utilities, API routes, or patterns it introduces
