-- Add NEW and DISMISSED to TicketStatus enum
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'NEW';
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'DISMISSED';

-- Add new columns to Ticket
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "isBulk"         BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dismissedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dismissedById"   TEXT;

-- Data backfill: map old triageState values to the new status model
-- PENDING → status = NEW
UPDATE "Ticket" SET "status" = 'NEW' WHERE "triageState" = 'PENDING';

-- FILTERED → status = DISMISSED (set dismissedAt from updatedAt; dismissedById stays NULL = system/legacy)
UPDATE "Ticket"
  SET "status"      = 'DISMISSED',
      "dismissedAt" = "updatedAt"
  WHERE "triageState" = 'FILTERED';

-- LIVE tickets stay unchanged (their status is already a lifecycle value)

-- FK + index for dismissedBy relation
ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_dismissedById_fkey"
    FOREIGN KEY ("dismissedById") REFERENCES "Agent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Ticket_dismissedById_idx" ON "Ticket"("dismissedById");

-- Drop old triageState column and its index
DROP INDEX IF EXISTS "Ticket_triageState_idx";
ALTER TABLE "Ticket" DROP COLUMN IF EXISTS "triageState";

-- Drop the TriageState enum (after column is gone)
DROP TYPE IF EXISTS "TriageState";

-- Also apply the previously unapplied kb_fts_tsv_column migration inline
-- (that migration adds a tsvector column; if already applied skip it)
