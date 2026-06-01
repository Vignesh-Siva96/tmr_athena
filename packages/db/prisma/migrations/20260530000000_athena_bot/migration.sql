-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Rename AGENT → PRIMARY_AGENT and add SECONDARY_AGENT
ALTER TYPE "AgentRole" RENAME VALUE 'AGENT' TO 'PRIMARY_AGENT';
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'SECONDARY_AGENT';

-- New enums
CREATE TYPE "BotProvider" AS ENUM ('GEMINI', 'OPENAI', 'ANTHROPIC');
CREATE TYPE "KbCrawlStatus" AS ENUM ('IDLE', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'FETCHED', 'INDEXED', 'FAILED', 'SKIPPED');

-- AiOperation / AiCallStatus / AiUsage were created outside Prisma migrations;
-- guard with DO blocks so this migration replays cleanly on a fresh shadow DB.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiOperation') THEN
    CREATE TYPE "AiOperation" AS ENUM ('SENTIMENT', 'TOPIC', 'CSAT');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiCallStatus') THEN
    CREATE TYPE "AiCallStatus" AS ENUM ('OK', 'ERROR');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AiUsage" (
    "id"               TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model"            TEXT NOT NULL,
    "operation"        "AiOperation" NOT NULL,
    "promptTokens"     INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens"      INTEGER NOT NULL,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL,
    "durationMs"       INTEGER NOT NULL,
    "status"           "AiCallStatus" NOT NULL,
    "errorMessage"     TEXT,
    "ticketId"         TEXT,
    "messageId"        TEXT,
    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");
CREATE INDEX IF NOT EXISTS "AiUsage_operation_createdAt_idx" ON "AiUsage"("operation", "createdAt");

-- Extend AiOperation enum
ALTER TYPE "AiOperation" ADD VALUE IF NOT EXISTS 'ATHENA_EMBED';
ALTER TYPE "AiOperation" ADD VALUE IF NOT EXISTS 'ATHENA_GENERATE';
ALTER TYPE "AiOperation" ADD VALUE IF NOT EXISTS 'KB_CONTEXTUAL_SUMMARY';

-- AppConfig: bot + KB + timezone fields
ALTER TABLE "AppConfig"
  ADD COLUMN IF NOT EXISTS "botEnabled"             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "botProvider"            "BotProvider",
  ADD COLUMN IF NOT EXISTS "botApiKeyEnc"           TEXT,
  ADD COLUMN IF NOT EXISTS "botModelChat"           TEXT,
  ADD COLUMN IF NOT EXISTS "botModelEmbedding"      TEXT,
  ADD COLUMN IF NOT EXISTS "botRetrievalThreshold"  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS "botConfidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  ADD COLUMN IF NOT EXISTS "botFallbackAgentId"     TEXT,
  ADD COLUMN IF NOT EXISTS "botName"                TEXT NOT NULL DEFAULT 'Athena',
  ADD COLUMN IF NOT EXISTS "botAvatarUrl"           TEXT,
  ADD COLUMN IF NOT EXISTS "kbRootUrl"              TEXT,
  ADD COLUMN IF NOT EXISTS "kbCrawlStatus"          "KbCrawlStatus" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS "kbCrawlStartedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "kbCrawlFinishedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "kbCrawlPagesSeen"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kbCrawlPagesIndexed"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kbCrawlError"           TEXT,
  ADD COLUMN IF NOT EXISTS "kbLastRecrawledAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "timezone"               TEXT NOT NULL DEFAULT 'UTC';

-- Message: bot authorship
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "authorBotName" TEXT;

-- AiUsage: per-user tracking
ALTER TABLE "AiUsage"
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "AiUsage_userId_idx" ON "AiUsage"("userId");

ALTER TABLE "AiUsage"
  ADD CONSTRAINT "AiUsage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shift table
CREATE TABLE IF NOT EXISTS "Shift" (
    "id"             TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "primaryAgentId" TEXT NOT NULL,
    "dayOfWeek"      INTEGER NOT NULL,
    "startMinute"    INTEGER NOT NULL,
    "endMinute"      INTEGER NOT NULL,
    "active"         BOOLEAN NOT NULL DEFAULT true,
    "lastAssignedAt" TIMESTAMP(3),
    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Shift_primaryAgentId_idx" ON "Shift"("primaryAgentId");
CREATE INDEX IF NOT EXISTS "Shift_dayOfWeek_idx" ON "Shift"("dayOfWeek");

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_primaryAgentId_fkey"
    FOREIGN KEY ("primaryAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- KnowledgeSource table
CREATE TABLE IF NOT EXISTS "KnowledgeSource" (
    "id"           TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    "url"          TEXT NOT NULL,
    "title"        TEXT,
    "contentHash"  TEXT,
    "status"       "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "fetchedAt"    TIMESTAMP(3),
    "indexedAt"    TIMESTAMP(3),
    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeSource_url_key" ON "KnowledgeSource"("url");
CREATE INDEX IF NOT EXISTS "KnowledgeSource_status_idx" ON "KnowledgeSource"("status");

-- KnowledgeChunk table
CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
    "id"            TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceId"      TEXT NOT NULL,
    "ordinal"       INTEGER NOT NULL,
    "text"          TEXT NOT NULL,
    "contextHeader" TEXT,
    "headingPath"   TEXT[] NOT NULL DEFAULT '{}',
    "anchor"        TEXT,
    "deepUrl"       TEXT NOT NULL,
    "tokenCount"    INTEGER NOT NULL,
    "embedding"     vector(768),
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_sourceId_idx" ON "KnowledgeChunk"("sourceId");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_deepUrl_idx" ON "KnowledgeChunk"("deepUrl");

-- HNSW vector index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS "knowledge_chunk_embedding_hnsw" ON "KnowledgeChunk"
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- pg_trgm GIN index for hybrid sparse retrieval
CREATE INDEX IF NOT EXISTS "knowledge_chunk_text_trgm" ON "KnowledgeChunk"
  USING gin (text gin_trgm_ops);

ALTER TABLE "KnowledgeChunk"
  ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BotInteraction table
CREATE TABLE IF NOT EXISTS "BotInteraction" (
    "id"                 TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId"           TEXT NOT NULL,
    "userId"             TEXT NOT NULL,
    "messageId"          TEXT,
    "retrievedChunkIds"  TEXT[] NOT NULL DEFAULT '{}',
    "retrievalTopScore"  DOUBLE PRECISION,
    "llmConfidence"      DOUBLE PRECISION,
    "didAnswer"          BOOLEAN NOT NULL,
    "escalatedToAgentId" TEXT,
    "reasoning"          TEXT,
    "citations"          TEXT[] NOT NULL DEFAULT '{}',
    "latencyMs"          INTEGER NOT NULL,
    "costUsd"            DECIMAL(10,6) NOT NULL,
    "totalTokens"        INTEGER NOT NULL,
    "promptTokens"       INTEGER NOT NULL,
    "completionTokens"   INTEGER NOT NULL,
    CONSTRAINT "BotInteraction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BotInteraction_ticketId_idx" ON "BotInteraction"("ticketId");
CREATE INDEX IF NOT EXISTS "BotInteraction_userId_idx" ON "BotInteraction"("userId");
CREATE INDEX IF NOT EXISTS "BotInteraction_createdAt_idx" ON "BotInteraction"("createdAt");

ALTER TABLE "BotInteraction"
  ADD CONSTRAINT "BotInteraction_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BotInteraction"
  ADD CONSTRAINT "BotInteraction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BotInteraction"
  ADD CONSTRAINT "BotInteraction_escalatedToAgentId_fkey"
    FOREIGN KEY ("escalatedToAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
