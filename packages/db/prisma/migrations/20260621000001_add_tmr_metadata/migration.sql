-- CreateEnum
CREATE TYPE "TmrSyncStatus" AS ENUM ('PENDING', 'OK', 'NOT_FOUND', 'ERROR');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tmrMetadata" JSONB,
ADD COLUMN     "tmrMetadataAt" TIMESTAMP(3),
ADD COLUMN     "tmrMetadataStatus" "TmrSyncStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "tmrUserId" TEXT;
