-- Fix Tag schema drift: initial migration created orgId NOT NULL + (orgId, name) unique index,
-- but schema.prisma dropped orgId in favour of name @unique. Reconcile the DB.

DROP INDEX IF EXISTS "Tag_orgId_name_key";
ALTER TABLE "Tag" DROP COLUMN IF EXISTS "orgId";
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_name_key" ON "Tag"("name");
