-- Item 4: Remove botModelChat column (chat model is hardcoded in backend)
ALTER TABLE "AppConfig" DROP COLUMN IF EXISTS "botModelChat";

-- Item 3: Add SCANNED status to SourceStatus enum
ALTER TYPE "SourceStatus" ADD VALUE IF NOT EXISTS 'SCANNED';

-- Item 3: Add KbPhase enum for two-phase scan → confirm → embed flow
DO $$ BEGIN
  CREATE TYPE "KbPhase" AS ENUM ('IDLE','SCANNING','AWAITING_CONFIRM','EMBEDDING','DONE','FAILED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Item 3: Add two-phase KB progress fields to AppConfig
ALTER TABLE "AppConfig"
  ADD COLUMN IF NOT EXISTS "kbPhase" "KbPhase" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS "kbScanPagesSeen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kbScanChunkCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kbScanTokenEstimate" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kbScanCostUsd" DECIMAL(12,6),
  ADD COLUMN IF NOT EXISTS "kbEmbedChunksDone" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kbEmbedChunksTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kbError" TEXT;
