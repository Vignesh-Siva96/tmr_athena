-- Add generated tsvector column for full-text search on KnowledgeChunk.
-- This replaces the pg_trgm sparse arm with proper FTS (websearch_to_tsquery).
-- The stored generated column is updated automatically on INSERT/UPDATE.

ALTER TABLE "KnowledgeChunk"
  ADD COLUMN IF NOT EXISTS "tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_tsv_gin"
  ON "KnowledgeChunk" USING GIN("tsv");
