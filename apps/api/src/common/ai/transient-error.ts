// HTTP statuses worth retrying: request timeout, rate limit, and the 5xx
// "try again later" family Google returns when a model is overloaded
// (e.g. the 503 "this model is currently experiencing high demand").
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504])

// Failures that never reach (or carry) an HTTP status: network-layer errors and
// aborted/timed-out requests. The Gemini SDK's GoogleGenerativeAIAbortError and
// raw fetch/undici TypeErrors surface only through their message.
const TRANSIENT_MESSAGE =
  /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|abort|tim-?ed?\s*out|timeout/i

/**
 * True when a Gemini call failed for a reason a retry could plausibly fix — an
 * overloaded model (503), rate limit (429), gateway/5xx blip, or a network/
 * timeout abort. Deterministic failures (a 400 bad request, a 401/403 auth
 * error, or our own zod/JSON parse failure on model drift) return false:
 * retrying those only burns tokens and delays the inevitable.
 *
 * Detection is structural (a numeric `status`, else a message match) rather than
 * `instanceof` on the SDK's error classes — those checks are fragile across
 * module/bundler boundaries, and this keeps the helper dependency-free so it's
 * shared cheaply by the bot's GeneratorService and the analysis GeminiService.
 */
export function isTransientGeminiError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false

  // GoogleGenerativeAIFetchError carries the upstream HTTP status. A numeric
  // status lets us classify precisely; the SDK's parse/input error types have
  // none and fall through to the message check below.
  const status = (err as { status?: unknown }).status
  if (typeof status === 'number') return TRANSIENT_STATUS.has(status)

  const message = err instanceof Error ? err.message : String((err as { message?: unknown }).message ?? '')
  return TRANSIENT_MESSAGE.test(message)
}
