# Shelfle — Codebase Context

## What It Is

Shelfle is a Next.js 15 web app where users guess games from their Steam library. It has multiple game modes. The owner plans to keep adding new modes.

**Live stack:** Next.js 15 (App Router), TypeScript, Prisma ORM, PostgreSQL, NextAuth v4 (Steam OAuth), Tailwind CSS.

---

## Project Structure

```
src/
  app/
    layout.tsx              # Root layout — injects Navbar, sets bg-gray-950 on body
    loading.tsx             # Shared loading UI — covers all routes (no per-mode loading files needed)
    page.tsx                # Home page (mode cards, stats, friends)
    play/page.tsx           # Classic mode server entry
    zoom/page.tsx           # Zoom mode server entry
    achievement/page.tsx    # Achievement mode server entry
    description/page.tsx    # Description mode server entry
    higherlower/page.tsx    # Higher/Lower mode server entry
    library/page.tsx        # Library browser (paginated table of enriched games)
    challenge/
      [id]/
        page.tsx            # Challenge landing page (share link or accept CTA)
        results/page.tsx    # Side-by-side results after both players finish
    api/
      auth/[...nextauth]/   # NextAuth Steam OAuth handler
      challenge/
        route.ts            # POST create challenge from a completed round
        [id]/route.ts       # GET fetch challenge + both participants' round data
      game/
        route.ts            # GET restore round / POST start new Classic round
        guess/route.ts      # POST submit Classic guess
        search/route.ts     # GET search games in active round's library
      zoom/
        route.ts            # GET restore round / POST start new Zoom round
        guess/route.ts      # POST submit Zoom guess
      achievement/
        route.ts            # GET/POST Achievement round
        guess/route.ts      # POST submit Achievement guess
      description/
        route.ts            # GET/POST Description round
        guess/route.ts      # POST submit Description guess
      higherlower/
        route.ts            # GET/POST Higher/Lower round
        guess/route.ts      # POST submit Higher/Lower guess
  components/
    Navbar.tsx              # Shared top nav (server component)
    NavLinks.tsx            # Client component — active link highlighting
    NavUser.tsx             # Client component — avatar + sign-out button
    SessionProvider.tsx     # NextAuth SessionProvider wrapper
    SteamLoginButton.tsx    # Steam OAuth login button
    FriendLibraryInput.tsx  # Input for Steam ID / vanity URL
    FriendsList.tsx         # Sidebar list of Steam friends with Play dropdowns
    challenge/
      ChallengeActions.tsx  # Client component — copy-link row used on challenge landing page
    game/
      GameClient.tsx        # Classic mode UI (full client component)
      ZoomClient.tsx        # Zoom mode UI
      AchievementClient.tsx # Achievement mode UI
      DescriptionClient.tsx # Description mode UI
      HigherLowerClient.tsx # Higher/Lower mode UI
  lib/
    db.ts                   # Prisma client singleton
    logger.ts               # File-based logger (logs/app.log)
    description.ts          # Shared types + buildRound() + redactTitle() for Description mode
    auth/
      config.ts             # NextAuth config (Steam provider, JWT callbacks)
    steam/
      api.ts                # Steam/SteamSpy API calls (cached with next/cache)
      sync.ts               # syncUser(), syncLibrary()
      types.ts              # GameInfo type (raw enriched game data)
    game/
      compare.ts            # computeComparison() — Classic mode diff logic
  generated/prisma/         # Prisma generated client (do not edit)
prisma/
  schema.prisma
  migrations/
    20260528074017_init/migration.sql
    20260604000000_add_indexes/migration.sql   # trigram + round indexes
```

---

## Database Schema

```prisma
User          { id, steamId, displayName, syncedAt }
Game          { steamAppId (PK), title, headerImage, tags[], releaseYear,
                reviewPct, totalAchievements, avgPlayers24h,
                priceChfCents, priceUsdCents, priceEurCents, cachedAt }
UserGame      { userId, steamAppId, playtimeHours }   -- composite PK
Round         { id, playerUserId, targetUserId, targetAppId,
                mode (varchar), status (active/won/lost/abandoned),
                challengeId? (FK → Challenge), createdAt }
Guess         { id, roundId, guessedAppId, resultJson (JSONB), guessedAt }
Stats         { userId (PK), roundsPlayed, roundsWon, currentStreak, bestStreak }
Challenge     { id, mode, gameAppId? (null for HigherLower), targetUserId,
                creatorId, status (pending/completed), expiresAt, createdAt }
```

**Key design decisions:**
- `Round.mode` is a plain varchar — add any string you want ("classic", "zoom", "yourmode")
- `Round.targetUserId` = the library being guessed from (equals playerUserId in solo, friend's userId in friend mode)
- `Round.challengeId` links a round to a challenge — both the creator's and opponent's rounds point to the same `Challenge` row
- `Guess.resultJson` is untyped JSONB — each mode stores its own structure there
- `Stats` only tracks Classic mode wins currently
- `Challenge.gameAppId` is null for HigherLower (no fixed game — score comparison only)

---

## How Game Modes Work — The Pattern

Every mode follows the same structure. Use Classic + Zoom as templates.

### 1. Server page (`src/app/<mode>/page.tsx`)
- Server component
- Calls `getServerSession`, redirects to `/` if unauthenticated
- Calls `syncUser` + `syncLibrary` to keep the library fresh
- Reads `searchParams` for `friend`, `friendName`, `friendAvatar`, **and `challenge`**
- If `?challenge=<id>` is present: loads the challenge, validates it, creates a forced round linked to that challenge, and passes `challengeId` to the client (see *1v1 Challenges* section below)
- Otherwise: checks for an existing solo round to resume, or abandons active rounds + creates a new one
- Passes the round as `initialRound` to the client — **no client-side loading bar on first load**

### 2. Client component (`src/components/game/YourModeClient.tsx`)
- `"use client"` — handles all game state
- Accepts `initialRound?: YourRoundType` prop — if provided, skips all initial fetching and renders the game immediately
- On mount (only if no `initialRound`): calls `GET /api/<mode>` to restore an active round; if none found → auto-calls `startGame()`
- `startGame()`: POSTs to `/api/<mode>`, shows a `<LoadingBar>` with staged progress labels (used for "Play Again" after a round ends)
- `submitGuess(game)`: POSTs to `/api/<mode>/guess`, updates round state from response
- Uses `GET /api/game/search?q=` for the game search dropdown (shared across all modes)
- No page header — the shared `<Navbar>` is injected by `layout.tsx`
- "New Game" button calls `startGame()` directly (not a state reset)

### 3. API route (`src/app/api/<mode>/route.ts`)

The GET is no longer called on initial page load (the server page handles that). It still exists as a fallback.

**POST** — start new round (called by `startGame()` for "Play Again"):
1. Abandon all active rounds: `db.round.updateMany({ where: { playerUserId, status: "active" }, data: { status: "abandoned" } })`
2. Parse `friendSteamId` from body (optional)
3. If friend: `resolveSteamId()` → `getSteamProfile()` → `syncUser()` → `syncLibrary()` → `revalidateTag("library")` + `revalidateTag("game-search")`
4. `pickEnrichedGame(targetUser.id)` — filter `UserGame` where game has `tags.length > 0 && releaseYear !== null && reviewPct !== null && headerImage !== ""`
5. `db.round.create({ mode: "yourmode", ... })`
6. Return round shape: `{ id, status: "active", guesses: [], maxGuesses, friendName?, ...any mode-specific fields }`

### 4. Guess route (`src/app/api/<mode>/guess/route.ts`)

```ts
// Get user without syncUser (plain read, no upsert)
const [user, body] = await Promise.all([
  db.user.findUnique({ where: { steamId: session.user.steamId } }),
  req.json(),
]);

// Find active round — ALWAYS filter by mode to avoid cross-mode interference
const round = await db.round.findFirst({
  where: { playerUserId: user.id, mode: "yourmode", status: "active" },
  include: { guesses: true, game: true },
  orderBy: { createdAt: "desc" },
});

// Validate: round exists, max guesses not hit, no duplicate guess

// Compute result, create Guess record with resultJson
// If won or lost: update Round.status, update Stats (roundsPlayed, roundsWon, streak)
```

---

## 1v1 Challenges

Async head-to-head: Player A finishes a round → shares a link → Player B plays the same game → results compared.

### Flow

1. After any round ends, the client shows a **"Challenge a Friend"** button (only if not already in a challenge response).
2. Clicking it calls `POST /api/challenge` with `{ roundId }` → returns `{ challengeId }`.
3. The client shows a copy-able link: `<origin>/challenge/<id>`.
4. Player B opens the link → `/challenge/[id]` landing page → clicks "Accept Challenge".
5. The button links to the mode's page with `?challenge=<id>` (e.g. `/play?challenge=<id>`).
6. The mode page detects the param, validates the challenge, creates a forced round (same game + same library) linked to the challenge via `Round.challengeId`.
7. After finishing, the client shows **"View Challenge Results"** → `/challenge/[id]/results`.

### Key rules

- Challenges expire after **48 hours**.
- Achievement and Description challenges reuse the creator's `InitRecord` (first guess) so both players see the exact same achievement/description.
- HigherLower challenges share the same library (`targetUserId`) but use random game pairs — winner is determined by final score.
- The creator's round and opponent's round both have `challengeId` pointing to the same `Challenge` row. The results page queries `challenge.rounds` to find both.

### API routes

| Route | Purpose |
|---|---|
| `POST /api/challenge` | Create a challenge from a finished round |
| `GET /api/challenge/[id]` | Fetch challenge metadata + serialised round summaries for both players |

### Pages

| Page | Purpose |
|---|---|
| `/challenge/[id]` | Landing — shows mode, creator name, share link (creator) or "Accept Challenge" CTA (opponent) |
| `/challenge/[id]/results` | Side-by-side result cards with winner declaration |

---

## Navigation

All game modes are registered in **`src/lib/gameModes.ts`** — add your mode there once and it automatically appears in the navbar, the friends "Play" dropdown, and the home page cards.

See `ADDING_A_GAME_MODE.md` for the full step-by-step guide.

---

## Key Utilities

### `syncLibrary(userId, steamId)` — `src/lib/steam/sync.ts`
Call this in your server page. It:
- Once per hour: fetches owned games from Steam, stub-inserts new games, upserts playtime
- Every visit: enriches up to 50 unenriched games (full details) + 50 stale games (player count + review refresh)
- Returns total game count

### `syncUser(steamId, displayName)` — `src/lib/steam/sync.ts`
Upserts the user row. Call only in server pages and route POST handlers (where you need the user object). **Do NOT call in guess routes** — use `db.user.findUnique` there to avoid the upsert overhead.

### `resolveSteamId(input)` — `src/lib/steam/api.ts`
Resolves a 17-digit ID, profile URL, or vanity name to a canonical 64-bit steamId string. Returns `null` on failure.

### `getSteamProfile(steamId)` — `src/lib/steam/api.ts`
Returns `{ displayName, avatarUrl }`. 1-hour Next.js cache.

### `getSteamFriends(steamId)` — `src/lib/steam/api.ts`
Returns up to 100 friends as `{ steamId, displayName, avatarUrl }[]`. 5-min cache.

### `computeComparison(guess, target)` — `src/lib/game/compare.ts`
Classic mode diff logic. Returns `GuessComparison` with per-field status (exact / close_higher / close_lower / higher / lower / unknown) and a `won` boolean.

---

## Auth & Session

```ts
// Server component / route handler
import { getServerSession } from "next-auth";
import { authCallbacks } from "@/lib/auth/config";
const session = await getServerSession(authCallbacks);
// session.user.steamId  — Steam 64-bit ID
// session.user.name     — Steam display name
// session.user.image    — Steam avatar URL

// Client component
import { useSession } from "next-auth/react";
const { data: session } = useSession();
```

---

## Enriched Game Pool

A game is eligible to be picked for any mode if:
```ts
game.tags.length > 0 && game.releaseYear !== null && game.reviewPct !== null && game.headerImage !== ""
```

This is enforced in `pickEnrichedGame()` inside each mode's route. Zoom mode additionally ensures `headerImage !== ""` (same condition in practice).

---

## Styling Conventions

- Dark theme: `bg-gray-950` root, `bg-gray-900` cards/inputs, `border-gray-800` borders
- Blue accent: `bg-blue-600 hover:bg-blue-500` for primary actions
- All pages are `<main className="max-w-Nxl mx-auto px-4 sm:px-6 py-6">` — no full-screen layouts (Navbar takes 3.5rem at the top)
- Game status colors: `bg-green-700` exact/win, `bg-yellow-700` close, `bg-gray-700` wrong direction, `bg-gray-800` default
- Loading: always use `<LoadingBar pct={n} label="..." />` — never a spinner

---

## DB Indexes (already applied via migration)

- `rounds(playerUserId, status)` — B-tree, for active round lookups
- `games.title` — GIN trigram (`pg_trgm`), for fast case-insensitive search
- `user_games(userId, steamAppId)` — composite PK doubles as index on userId prefix
