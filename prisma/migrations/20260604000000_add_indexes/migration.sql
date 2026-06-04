-- Enable trigram extension for fast case-insensitive title search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index for active round lookups (playerUserId + status filter used on every guess/search)
CREATE INDEX "rounds_playerUserId_status_idx" ON "rounds" ("playerUserId", "status");

-- GIN trigram index for fast case-insensitive title search
CREATE INDEX "games_title_trgm_idx" ON "games" USING GIN (lower("title") gin_trgm_ops);
