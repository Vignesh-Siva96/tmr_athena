-- Baseline migration: full schema as of the squash (replaces the pre-squash history).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('ADMIN', 'PRIMARY_AGENT', 'SECONDARY_AGENT');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('OK', 'ERROR');

-- CreateEnum
CREATE TYPE "AiOperation" AS ENUM ('SENTIMENT', 'TOPIC', 'CSAT', 'ATHENA_EMBED', 'ATHENA_GENERATE', 'KB_CONTEXTUAL_SUMMARY');

-- CreateEnum
CREATE TYPE "ArchiveStatus" AS ENUM ('IDLE', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuthLayout" AS ENUM ('MINIMAL', 'BRANDED');

-- CreateEnum
CREATE TYPE "BotProvider" AS ENUM ('GEMINI', 'OPENAI', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('ACTIVE', 'BOUNCING', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ExternalProvider" AS ENUM ('GMAIL', 'GRAPH');

-- CreateEnum
CREATE TYPE "KbCrawlStatus" AS ENUM ('IDLE', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KbPhase" AS ENUM ('IDLE', 'SCANNING', 'AWAITING_CONFIRM', 'EMBEDDING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MagicTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "MessageSentVia" AS ENUM ('PORTAL', 'EMAIL', 'PORTAL_AND_EMAIL');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('REPLY', 'INTERNAL_NOTE', 'SYSTEM_EVENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('GITHUB_ISSUE_UPDATED', 'CHURN_RISK_DETECTED');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "ParticipantSource" AS ENUM ('AGENT', 'INBOUND');

-- CreateEnum
CREATE TYPE "SentimentLabel" AS ENUM ('NEGATIVE', 'NEUTRAL', 'POSITIVE');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('CHURN_RISK', 'ADVOCACY');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'FETCHED', 'SCANNED', 'INDEXED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('BUG_REPORT', 'FEATURE_REQUEST', 'QUESTION', 'BILLING', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('PORTAL', 'EMAIL');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TmrSyncStatus" AS ENUM ('PENDING', 'OK', 'NOT_FOUND', 'ERROR');

-- CreateEnum
CREATE TYPE "UserCategory" AS ENUM ('CUSTOMER', 'MARKETING', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "UserSource" AS ENUM ('PORTAL', 'EMAIL', 'INVITE', 'SSO');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "password" TEXT,
    "googleId" TEXT,
    "role" "AgentRole" NOT NULL DEFAULT 'PRIMARY_AGENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActiveAt" TIMESTAMP(3),
    "inviteToken" TEXT,
    "inviteAccepted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "operation" "AiOperation" NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "errorMessage" TEXT,
    "ticketId" TEXT,
    "messageId" TEXT,
    "userId" TEXT,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appName" TEXT NOT NULL DEFAULT 'Support',
    "logoUrl" TEXT,
    "portalTagline" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563EB',
    "accentColor" TEXT NOT NULL DEFAULT '#0EA5E9',
    "emailDisplayName" TEXT NOT NULL DEFAULT 'Support',
    "supportEmail" TEXT,
    "customDomain" TEXT,
    "githubWebhookSecret" TEXT,
    "webhookVerifiedAt" TIMESTAMP(3),
    "oauthProvider" "OAuthProvider",
    "oauthEmail" TEXT,
    "oauthAccessTokenEnc" TEXT,
    "oauthRefreshTokenEnc" TEXT,
    "oauthTokenExpiresAt" TIMESTAMP(3),
    "oauthScopes" TEXT,
    "oauthAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gmailHistoryId" TEXT,
    "graphDeltaLink" TEXT,
    "archivePageToken" TEXT,
    "archiveStatus" "ArchiveStatus" NOT NULL DEFAULT 'IDLE',
    "archiveTotalSeen" INTEGER,
    "archiveTotalEstimate" INTEGER,
    "portalAuthLayout" "AuthLayout" NOT NULL DEFAULT 'MINIMAL',
    "portalHeroHeadline" TEXT,
    "portalHeroSubheadline" TEXT,
    "portalFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "botProvider" "BotProvider",
    "botApiKeyEnc" TEXT,
    "botFallbackAgentId" TEXT,
    "ssoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ssoSecretEnc" TEXT,
    "kbRootUrl" TEXT,
    "kbCrawlStatus" "KbCrawlStatus" NOT NULL DEFAULT 'IDLE',
    "kbCrawlStartedAt" TIMESTAMP(3),
    "kbCrawlFinishedAt" TIMESTAMP(3),
    "kbCrawlPagesSeen" INTEGER NOT NULL DEFAULT 0,
    "kbCrawlPagesIndexed" INTEGER NOT NULL DEFAULT 0,
    "kbCrawlError" TEXT,
    "kbLastRecrawledAt" TIMESTAMP(3),
    "kbPhase" "KbPhase" NOT NULL DEFAULT 'IDLE',
    "kbScanPagesSeen" INTEGER NOT NULL DEFAULT 0,
    "kbScanChunkCount" INTEGER NOT NULL DEFAULT 0,
    "kbScanTokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "kbScanCostUsd" DECIMAL(12,6),
    "kbEmbedChunksDone" INTEGER NOT NULL DEFAULT 0,
    "kbEmbedChunksTotal" INTEGER NOT NULL DEFAULT 0,
    "kbError" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "field1Label" TEXT,
    "field1Options" JSONB NOT NULL DEFAULT '[]',
    "field2Label" TEXT,
    "field2Options" JSONB NOT NULL DEFAULT '[]',
    "mirrorPortalRepliesToEmail" BOOLEAN NOT NULL DEFAULT true,
    "slaFirstResponseHours" INTEGER NOT NULL DEFAULT 4,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "featConfirmationEmail" BOOLEAN NOT NULL DEFAULT true,
    "featBotReply" BOOLEAN NOT NULL DEFAULT true,
    "featAiAnalysis" BOOLEAN NOT NULL DEFAULT true,
    "featCsatSurvey" BOOLEAN NOT NULL DEFAULT true,
    "featGithubIssueCreation" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT,
    "messageId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "isLink" BOOLEAN NOT NULL DEFAULT false,
    "linkUrl" TEXT,
    "objectKey" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotInteraction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT,
    "retrievedChunkIds" TEXT[],
    "retrievalTopScore" DOUBLE PRECISION,
    "llmConfidence" DOUBLE PRECISION,
    "didAnswer" BOOLEAN NOT NULL,
    "escalatedToAgentId" TEXT,
    "reasoning" TEXT,
    "citations" TEXT[],
    "latencyMs" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,

    CONSTRAINT "BotInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CannedResponse" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSignal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "SignalType" NOT NULL,
    "quote" TEXT NOT NULL,
    "reason" TEXT,
    "messageId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CustomerSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accessToken" TEXT NOT NULL,
    "githubUsername" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "defaultRepo" TEXT,

    CONSTRAINT "GithubConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubIssue" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ticketId" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "repo" TEXT NOT NULL,
    "issueUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "lastSyncedAt" TIMESTAMP(3),
    "labels" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "GithubIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubIssueEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "githubIssueId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorLogin" TEXT,
    "labelName" TEXT,
    "oldState" TEXT,
    "newState" TEXT,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubIssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contextHeader" TEXT,
    "headingPath" TEXT[],
    "anchor" TEXT,
    "deepUrl" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector,
    "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, text)) STORED,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "contentHash" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicToken" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" "MagicTokenType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "MagicToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "ticketId" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'REPLY',
    "body" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "authorUserId" TEXT,
    "authorAgentId" TEXT,
    "sentVia" "MessageSentVia",
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "authorBotName" TEXT,
    "messageId" TEXT,
    "externalMessageId" TEXT,
    "inReplyTo" TEXT,
    "bodyRaw" TEXT,
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentimentScore" DOUBLE PRECISION,
    "sentimentLabel" "SentimentLabel",
    "analyzedAt" TIMESTAMP(3),
    "customerEmailedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "ticketId" TEXT,
    "githubIssueNumber" INTEGER,
    "githubRepo" TEXT,
    "githubIssueTitle" TEXT,
    "appConfigId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "primaryAgentId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastAssignedAt" TIMESTAMP(3),

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoUsedToken" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoUsedToken_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#71717A',

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "ref" TEXT NOT NULL,
    "isTicket" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "category" "TicketCategory" NOT NULL,
    "field1" TEXT,
    "field2" TEXT,
    "source" "TicketSource" NOT NULL DEFAULT 'PORTAL',
    "isBulk" BOOLEAN NOT NULL DEFAULT false,
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "userId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "emailThreadId" TEXT NOT NULL,
    "externalThreadId" TEXT,
    "externalProvider" "ExternalProvider",
    "topicId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "firstResolvedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "githubUpdatePending" BOOLEAN NOT NULL DEFAULT false,
    "githubUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "TicketRating" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT NOT NULL,
    "userRating" INTEGER,
    "userComment" TEXT,
    "aiRating" INTEGER,
    "aiReasoning" TEXT,
    "aiEffortScore" INTEGER,
    "aiSummary" TEXT,
    "ratingToken" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ratedAt" TIMESTAMP(3),

    CONSTRAINT "TicketRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ticketCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "password" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "googleId" TEXT,
    "externalId" TEXT,
    "source" "UserSource" NOT NULL DEFAULT 'PORTAL',
    "category" "UserCategory" NOT NULL DEFAULT 'CUSTOMER',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailStatus" "EmailStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastActiveAt" TIMESTAMP(3),
    "tmrUserId" TEXT,
    "tmrMetadata" JSONB,
    "tmrMetadataStatus" "TmrSyncStatus" NOT NULL DEFAULT 'PENDING',
    "tmrMetadataAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TagToTicket" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Agent_email_idx" ON "Agent"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_email_key" ON "Agent"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_googleId_key" ON "Agent"("googleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_inviteToken_key" ON "Agent"("inviteToken" ASC);

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "AiUsage_operation_createdAt_idx" ON "AiUsage"("operation" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AiUsage_userId_idx" ON "AiUsage"("userId" ASC);

-- CreateIndex
CREATE INDEX "BotInteraction_createdAt_idx" ON "BotInteraction"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "BotInteraction_ticketId_idx" ON "BotInteraction"("ticketId" ASC);

-- CreateIndex
CREATE INDEX "BotInteraction_userId_idx" ON "BotInteraction"("userId" ASC);

-- CreateIndex
CREATE INDEX "CustomerSignal_ticketId_idx" ON "CustomerSignal"("ticketId" ASC);

-- CreateIndex
CREATE INDEX "CustomerSignal_type_createdAt_idx" ON "CustomerSignal"("type" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CustomerSignal_userId_idx" ON "CustomerSignal"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "GithubIssue_ticketId_key" ON "GithubIssue"("ticketId" ASC);

-- CreateIndex
CREATE INDEX "GithubIssueEvent_githubIssueId_createdAt_idx" ON "GithubIssueEvent"("githubIssueId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_deepUrl_idx" ON "KnowledgeChunk"("deepUrl" ASC);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_sourceId_idx" ON "KnowledgeChunk"("sourceId" ASC);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_tsv_gin" ON "KnowledgeChunk" USING GIN ("tsv");

-- CreateIndex
CREATE INDEX "KnowledgeSource_status_idx" ON "KnowledgeSource"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_url_key" ON "KnowledgeSource"("url" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MagicToken_token_key" ON "MagicToken"("token" ASC);

-- CreateIndex
CREATE INDEX "MagicToken_userId_type_idx" ON "MagicToken"("userId" ASC, "type" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalMessageId_key" ON "Message"("externalMessageId" ASC);

-- CreateIndex
CREATE INDEX "Message_messageId_idx" ON "Message"("messageId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Message_messageId_key" ON "Message"("messageId" ASC);

-- CreateIndex
CREATE INDEX "Message_ticketId_createdAt_idx" ON "Message"("ticketId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Message_ticketId_customerEmailedAt_idx" ON "Message"("ticketId" ASC, "customerEmailedAt" ASC);

-- CreateIndex
CREATE INDEX "Message_ticketId_idx" ON "Message"("ticketId" ASC);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Notification_ticketId_idx" ON "Notification"("ticketId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_notificationId_agentId_key" ON "NotificationRead"("notificationId" ASC, "agentId" ASC);

-- CreateIndex
CREATE INDEX "Shift_dayOfWeek_idx" ON "Shift"("dayOfWeek" ASC);

-- CreateIndex
CREATE INDEX "Shift_primaryAgentId_idx" ON "Shift"("primaryAgentId" ASC);

-- CreateIndex
CREATE INDEX "SsoUsedToken_expiresAt_idx" ON "SsoUsedToken"("expiresAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name" ASC);

-- CreateIndex
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId" ASC);

-- CreateIndex
CREATE INDEX "Ticket_dismissedById_idx" ON "Ticket"("dismissedById" ASC);

-- CreateIndex
CREATE INDEX "Ticket_emailThreadId_idx" ON "Ticket"("emailThreadId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_emailThreadId_key" ON "Ticket"("emailThreadId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_externalThreadId_key" ON "Ticket"("externalThreadId" ASC);

-- CreateIndex
CREATE INDEX "Ticket_isTicket_idx" ON "Ticket"("isTicket" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ref_key" ON "Ticket"("ref" ASC);

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status" ASC);

-- CreateIndex
CREATE INDEX "Ticket_topicId_idx" ON "Ticket"("topicId" ASC);

-- CreateIndex
CREATE INDEX "Ticket_userId_idx" ON "Ticket"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TicketParticipant_ticketId_email_key" ON "TicketParticipant"("ticketId" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "TicketParticipant_ticketId_idx" ON "TicketParticipant"("ticketId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TicketRating_ratingToken_key" ON "TicketRating"("ratingToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TicketRating_ticketId_key" ON "TicketRating"("ticketId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Topic_name_key" ON "Topic"("name" ASC);

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "_TagToTicket_AB_unique" ON "_TagToTicket"("A" ASC, "B" ASC);

-- CreateIndex
CREATE INDEX "_TagToTicket_B_index" ON "_TagToTicket"("B" ASC);

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInteraction" ADD CONSTRAINT "BotInteraction_escalatedToAgentId_fkey" FOREIGN KEY ("escalatedToAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInteraction" ADD CONSTRAINT "BotInteraction_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInteraction" ADD CONSTRAINT "BotInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSignal" ADD CONSTRAINT "CustomerSignal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSignal" ADD CONSTRAINT "CustomerSignal_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSignal" ADD CONSTRAINT "CustomerSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubIssue" ADD CONSTRAINT "GithubIssue_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubIssueEvent" ADD CONSTRAINT "GithubIssueEvent_githubIssueId_fkey" FOREIGN KEY ("githubIssueId") REFERENCES "GithubIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MagicToken" ADD CONSTRAINT "MagicToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorAgentId_fkey" FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_appConfigId_fkey" FOREIGN KEY ("appConfigId") REFERENCES "AppConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_primaryAgentId_fkey" FOREIGN KEY ("primaryAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_addedByAgentId_fkey" FOREIGN KEY ("addedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRating" ADD CONSTRAINT "TicketRating_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagToTicket" ADD CONSTRAINT "_TagToTicket_A_fkey" FOREIGN KEY ("A") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagToTicket" ADD CONSTRAINT "_TagToTicket_B_fkey" FOREIGN KEY ("B") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

