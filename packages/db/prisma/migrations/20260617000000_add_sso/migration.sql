-- AlterEnum: add SSO to UserSource
ALTER TYPE "UserSource" ADD VALUE IF NOT EXISTS 'SSO';

-- AlterTable: User — add externalId
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_externalId_key" ON "User"("externalId");

-- AlterTable: AppConfig — add SSO fields
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "ssoEnabled"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "ssoSecretEnc" TEXT;

-- CreateTable: SsoUsedToken (replay protection)
CREATE TABLE IF NOT EXISTS "SsoUsedToken" (
    "jti"       TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SsoUsedToken_pkey" PRIMARY KEY ("jti")
);
CREATE INDEX IF NOT EXISTS "SsoUsedToken_expiresAt_idx" ON "SsoUsedToken"("expiresAt");
