export const EMBEDDING_MODEL = 'gemini-embedding-001'
export const EMBEDDING_DIMENSIONS = 768
// USD per 1M tokens — gemini-embedding-001 pricing
export const EMBED_PRICE_PER_MILLION = 0.15

/**
 * gemini-embedding-001 at <3072 dims must be L2-normalised before storage/query.
 * Division by ||v|| ensures cosine-equivalent dot-product similarity on pgvector.
 */
export function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
  if (norm === 0) return v
  return v.map((x) => x / norm)
}
