# Shelfle

Shelfle is a Steam-powered guessing game web app built with Next.js. Players sign in with Steam, sync their library, and play multiple game-identification modes against their own collection or a friend's library.

## Features

- Steam authentication via NextAuth
- Multiple game modes including Classic, Zoom, Higher/Lower, and Achievement
- Friend-library support by entering a Steam ID, profile URL, or vanity URL
- Prisma + PostgreSQL persistence for rounds, guesses, and stats
- Enriched game metadata from Steam store data and review/player info

## Tech Stack

- Next.js 15 (App Router)
- React 19
- TypeScript
- Prisma ORM
- PostgreSQL
- NextAuth v4
- Tailwind CSS

## Project Structure

- `src/app` — routes, pages, and API handlers
- `src/components` — UI components and game clients
- `src/lib` — database, auth, Steam API helpers, and game logic
- `prisma` — Prisma schema and migrations

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example env file and update values:

```bash
cp .env.local.example .env.local
```

Required variables:

- `DATABASE_URL` — PostgreSQL connection string
- `STEAM_API_KEY` — Steam Web API key
- `NEXTAUTH_SECRET` — random secret for NextAuth
- `NEXTAUTH_URL` — local URL, usually `http://localhost:3000`

### 3. Set up the database

```bash
npx prisma generate
npx prisma migrate deploy
```

### 4. Run the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Available Scripts

```bash
npm run dev     # start Next.js development server
npm run build   # generate Prisma client and build the app
npm run start   # start production server
npm run lint    # run Next.js lint checks
```

## How the app works

- Users sign in with Steam and their profile is synced.
- The app loads game data from Steam and enriches it with tags, release year, review data, and pricing details.
- Each mode creates and tracks rounds using the database schema for guesses and outcomes.
- Shared helpers in `src/lib` manage Steam API calls, sync logic, and comparison behavior.

## Database Notes

The Prisma schema defines:

- `User` and `UserGame` for Steam account + library data
- `Game` for enriched metadata
- `Round` and `Guess` for game sessions and player guesses
- `Stats` for win streak tracking

## Notes for Contributors

- Add new game modes by updating the mode registry and following the existing page/API/client pattern.
- Keep styling consistent with the dark UI already used throughout the app.
- When changing the Prisma schema, run migrations and regenerate the client.

## License

This project is for personal/internal use unless otherwise specified.
