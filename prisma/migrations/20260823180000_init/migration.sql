-- Squashed baseline: generated from prisma/schema.prisma.
-- Replaces the previous init / add_indexes / add_short_description migrations,
-- which had drifted from the deployed schema (it was maintained with 'db push').

-- Required by the trigram index at the end of this file.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "steamId" VARCHAR(20) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "steamAppId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "headerImage" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[],
    "releaseYear" SMALLINT,
    "reviewPct" SMALLINT,
    "totalAchievements" SMALLINT,
    "avgPlayers24h" INTEGER,
    "priceUsdCents" INTEGER,
    "priceEurCents" INTEGER,
    "priceChfCents" INTEGER,
    "shortDescription" TEXT,
    "cachedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "games_pkey" PRIMARY KEY ("steamAppId")
);

-- CreateTable
CREATE TABLE "user_games" (
    "userId" UUID NOT NULL,
    "steamAppId" INTEGER NOT NULL,
    "playtimeHours" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_games_pkey" PRIMARY KEY ("userId","steamAppId")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "playerUserId" UUID NOT NULL,
    "targetUserId" UUID NOT NULL,
    "targetAppId" INTEGER NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "challengeId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "gameAppId" INTEGER,
    "targetUserId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guesses" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "guessedAppId" INTEGER NOT NULL,
    "resultJson" JSONB NOT NULL,
    "guessedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stats" (
    "userId" UUID NOT NULL,
    "roundsPlayed" INTEGER NOT NULL DEFAULT 0,
    "roundsWon" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stats_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_steamId_key" ON "users"("steamId");

-- CreateIndex
CREATE INDEX "rounds_playerUserId_status_idx" ON "rounds"("playerUserId", "status");

-- AddForeignKey
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_steamAppId_fkey" FOREIGN KEY ("steamAppId") REFERENCES "games"("steamAppId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_playerUserId_fkey" FOREIGN KEY ("playerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_targetAppId_fkey" FOREIGN KEY ("targetAppId") REFERENCES "games"("steamAppId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_gameAppId_fkey" FOREIGN KEY ("gameAppId") REFERENCES "games"("steamAppId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stats" ADD CONSTRAINT "stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- GIN trigram index for case-insensitive title search (ILIKE '%q%').
CREATE INDEX "games_title_trgm_idx" ON "games" USING GIN (lower("title") gin_trgm_ops);
