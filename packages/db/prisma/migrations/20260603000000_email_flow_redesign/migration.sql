-- Email Flow Redesign Migration
-- 1. UserCategory enum + User.category
-- 2. Ticket.ref (short code) + Ticket.isTicket flag
-- 3. Backfill both columns
-- 4. Add NOT NULL constraints + indexes
-- 5. Drop Ticket.number

-- Step 1: Create UserCategory enum and add User.category
DO $$ BEGIN
  CREATE TYPE "UserCategory" AS ENUM ('CUSTOMER', 'MARKETING', 'PROMOTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "User" ADD COLUMN "category" "UserCategory" NOT NULL DEFAULT 'CUSTOMER';

-- Backfill User.category: mark PROMOTIONAL for users whose ALL tickets are isBulk=true
-- (only users who have at least one ticket, and all of them are bulk)
UPDATE "User" u
SET "category" = 'PROMOTIONAL'
WHERE EXISTS (
  SELECT 1 FROM "Ticket" t WHERE t."userId" = u.id
)
AND NOT EXISTS (
  SELECT 1 FROM "Ticket" t WHERE t."userId" = u.id AND t."isBulk" = false
);

-- Step 2: Add Ticket.isTicket (backfill immediately)
ALTER TABLE "Ticket" ADD COLUMN "isTicket" BOOLEAN NOT NULL DEFAULT false;

-- Backfill isTicket: existing open/active tickets are real tickets
UPDATE "Ticket" SET "isTicket" = true
WHERE "status" NOT IN ('NEW', 'DISMISSED');

-- Step 3: Add Ticket.ref as nullable TEXT (will be populated, then set NOT NULL)
ALTER TABLE "Ticket" ADD COLUMN "ref" TEXT;

-- Backfill ref for every row using a PL/pgSQL loop with uniqueness retry
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  collision BOOLEAN;
  attempts INT;
  alphabet TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  i INT;
BEGIN
  FOR r IN SELECT id FROM "Ticket" WHERE ref IS NULL LOOP
    attempts := 0;
    LOOP
      -- Generate 7-char Crockford base32 code
      candidate := '';
      FOR i IN 1..7 LOOP
        candidate := candidate || substr(alphabet, (floor(random() * 32)::int + 1), 1);
      END LOOP;
      -- Check uniqueness
      SELECT EXISTS(SELECT 1 FROM "Ticket" WHERE ref = candidate) INTO collision;
      IF NOT collision THEN
        UPDATE "Ticket" SET ref = candidate WHERE id = r.id;
        EXIT;
      END IF;
      attempts := attempts + 1;
      IF attempts >= 10 THEN
        RAISE EXCEPTION 'Failed to generate unique ref for ticket %', r.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Step 4: Set NOT NULL constraint on ref now that all rows are populated
ALTER TABLE "Ticket" ALTER COLUMN "ref" SET NOT NULL;

-- Create unique index on ref
CREATE UNIQUE INDEX "Ticket_ref_key" ON "Ticket"("ref");

-- Create index on isTicket
CREATE INDEX "Ticket_isTicket_idx" ON "Ticket"("isTicket");

-- Step 5: Drop Ticket.number column (and its sequence)
ALTER TABLE "Ticket" DROP COLUMN "number";
