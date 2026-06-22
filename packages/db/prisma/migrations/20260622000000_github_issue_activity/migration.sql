-- Notification enum: GITHUB_FIX_DEPLOYED is removed (its whole flow + dashboard are gone).
-- Delete those rows first, then rename the value to the new GITHUB_ISSUE_UPDATED.
DELETE FROM "Notification" WHERE "type" = 'GITHUB_FIX_DEPLOYED';
ALTER TYPE "NotificationType" RENAME VALUE 'GITHUB_FIX_DEPLOYED' TO 'GITHUB_ISSUE_UPDATED';

-- AppConfig: drop the removed label-configuration fields.
ALTER TABLE "AppConfig" DROP COLUMN "fixDeployedLabel",
DROP COLUMN "pendingConfirmationLabel";

-- Ticket: GitHub linked-issue attention flag (decoupled from `status`).
ALTER TABLE "Ticket" ADD COLUMN     "githubUpdatePending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "githubUpdatedAt" TIMESTAMP(3);

-- GithubIssue: store current label set; drop unused columns.
ALTER TABLE "GithubIssue" ADD COLUMN     "labels" JSONB NOT NULL DEFAULT '[]',
DROP COLUMN "reviewers",
DROP COLUMN "daysOpen";

-- CreateTable: append-only activity log for a linked GitHub issue.
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

-- CreateIndex
CREATE INDEX "GithubIssueEvent_githubIssueId_createdAt_idx" ON "GithubIssueEvent"("githubIssueId", "createdAt");

-- AddForeignKey
ALTER TABLE "GithubIssueEvent" ADD CONSTRAINT "GithubIssueEvent_githubIssueId_fkey" FOREIGN KEY ("githubIssueId") REFERENCES "GithubIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
