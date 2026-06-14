-- AddColumn convertedAt to Ticket (set when email conversation is converted to a real ticket)
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP(3);

-- AddColumn slaFirstResponseHours to AppConfig
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "slaFirstResponseHours" INTEGER NOT NULL DEFAULT 4;
