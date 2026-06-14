-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MagicTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "MagicToken" ADD COLUMN IF NOT EXISTS "type" "MagicTokenType" NOT NULL DEFAULT 'EMAIL_VERIFICATION';
ALTER TABLE "MagicToken" ALTER COLUMN "type" DROP DEFAULT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MagicToken_userId_type_idx" ON "MagicToken"("userId", "type");
