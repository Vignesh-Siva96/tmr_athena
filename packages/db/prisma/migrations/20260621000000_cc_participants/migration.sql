-- CreateEnum
CREATE TYPE "ParticipantSource" AS ENUM ('AGENT', 'INBOUND');

-- AlterTable: add cc column to Message
ALTER TABLE "Message" ADD COLUMN "cc" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable: TicketParticipant
CREATE TABLE "TicketParticipant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "source" "ParticipantSource" NOT NULL DEFAULT 'AGENT',
    "addedByAgentId" TEXT,

    CONSTRAINT "TicketParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketParticipant_ticketId_idx" ON "TicketParticipant"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketParticipant_ticketId_email_key" ON "TicketParticipant"("ticketId", "email");

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_addedByAgentId_fkey" FOREIGN KEY ("addedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
