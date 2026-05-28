-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "steamId" VARCHAR(20) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "diskSizeGb" DECIMAL(5,1),
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
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
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
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stats" ADD CONSTRAINT "stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
