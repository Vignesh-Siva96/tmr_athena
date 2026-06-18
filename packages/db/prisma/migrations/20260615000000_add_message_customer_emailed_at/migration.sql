-- AlterTable
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "customerEmailedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_ticketId_customerEmailedAt_idx" ON "Message"("ticketId", "customerEmailedAt");
