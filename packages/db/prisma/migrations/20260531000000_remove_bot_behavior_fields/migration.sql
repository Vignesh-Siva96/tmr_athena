-- Remove bot behavior fields that are now hardcoded in code.
-- botEnabled, botModelEmbedding, botRetrievalThreshold, botConfidenceThreshold,
-- botName, botAvatarUrl are no longer user-configurable.
ALTER TABLE "AppConfig"
  DROP COLUMN IF EXISTS "botEnabled",
  DROP COLUMN IF EXISTS "botModelEmbedding",
  DROP COLUMN IF EXISTS "botRetrievalThreshold",
  DROP COLUMN IF EXISTS "botConfidenceThreshold",
  DROP COLUMN IF EXISTS "botName",
  DROP COLUMN IF EXISTS "botAvatarUrl";
