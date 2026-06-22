/**
 * Circular-ref-safe JSON stringify. Uses a WeakSet to detect already-visited
 * objects and replaces them with "[Circular]" instead of throwing.
 * Never throws — safe to call on any value including Axios errors.
 */
export const safeStringify = (obj: any): string => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
};

/**
 * Accurate UTF-8 byte size matching how GCP counts payload size.
 * Uses regular JSON.stringify (counts shared refs independently, same as GCP's
 * protobuf serializer). Falls back to safeStringify only for true circular refs.
 */
export const getSizeKB = (value: any): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") / 1024;
  } catch {
    return Buffer.byteLength(safeStringify(value), "utf8") / 1024;
  }
};

interface TruncateLimits {
  arrayLimit: number;
  stringLimit: number;
  depthLimit: number;
  objectKeyLimit: number;
}

const NORMAL_LIMITS: TruncateLimits = {
  arrayLimit: 5,
  stringLimit: 1000,
  depthLimit: 4,
  objectKeyLimit: 50,
};

const AGGRESSIVE_LIMITS: TruncateLimits = {
  arrayLimit: 3,
  stringLimit: 500,
  depthLimit: 3,
  objectKeyLimit: 20,
};

/**
 * Single-pass recursive truncation.
 *
 * Traverses the tree once and creates new objects/arrays as it goes —
 * no lodash cloneDeep needed (the recursive walk is effectively a selective
 * clone + truncation in one pass).
 *
 * Decisions are based purely on structure (array length, string length, depth) —
 * zero per-field JSON.stringify calls.
 */
const truncateRecursive = (
  value: any,
  depth: number,
  limits: TruncateLimits,
): any => {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    if (value.length > limits.arrayLimit) {
      const kept = value
        .slice(0, limits.arrayLimit)
        .map((el) => truncateRecursive(el, depth + 1, limits));
      kept.push({
        _truncated: true,
        totalCount: value.length,
        hiddenCount: value.length - limits.arrayLimit,
      });
      return kept;
    }
    return value.map((el) => truncateRecursive(el, depth + 1, limits));
  }

  if (typeof value === "string") {
    if (value.length > limits.stringLimit) {
      return `${value.slice(0, limits.stringLimit)} ...[truncated from ${value.length} chars]`;
    }
    return value;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (depth >= limits.depthLimit) {
      return {
        _summary: true,
        keyCount: entries.length,
        keys: entries.slice(0, 20).map(([k]) => k),
      };
    }
    if (entries.length > limits.objectKeyLimit) {
      const result: Record<string, any> = {};
      for (const [k, v] of entries.slice(0, limits.objectKeyLimit)) {
        result[k] = truncateRecursive(v, depth + 1, limits);
      }
      result._truncated = true;
      result._totalKeyCount = entries.length;
      result._hiddenKeyCount = entries.length - limits.objectKeyLimit;
      return result;
    }
    const result: Record<string, any> = {};
    for (const [k, v] of entries) {
      result[k] = truncateRecursive(v, depth + 1, limits);
    }
    return result;
  }

  // Primitives pass through unchanged.
  return value;
};

const SUMMARY_STRING_LIMIT = 200;

const summarizeValue = (value: any): any => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > SUMMARY_STRING_LIMIT) {
      return `${value.slice(0, SUMMARY_STRING_LIMIT)} ...[truncated from ${value.length} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return { _type: "array", _length: value.length };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return {
      _type: "object",
      _keyCount: keys.length,
      _keys: keys.slice(0, 20),
    };
  }
  return value;
};

/**
 * Safety-net fallback: keeps top-level scalar fields intact and replaces
 * every nested object/array with a one-line structural summary.
 */
const forceTopLevelSummary = (payload: any): any => {
  if (payload === null || typeof payload !== "object") {
    return summarizeValue(payload);
  }
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    result[k] = summarizeValue(v);
  }
  return result;
};

/**
 * Smart truncation of a log payload with escalating strategies.
 *
 * Pass 1 (normal):     arrays→5, strings→1000, depth→4, object keys→50
 * Pass 2 (aggressive): arrays→3, strings→500,  depth→3, object keys→20
 * Pass 3 (safety net): structural summary of top-level fields — fires whenever
 *                      passes 1+2 couldn't get the payload under budget.
 *
 * @param payload     - The log object to truncate (never mutated)
 * @param maxSizeKB   - Target size in KB (default 180 — leaves headroom under GCP's 256KB)
 * @param knownSizeKB - Caller-supplied size to skip the initial measurement
 */
export const truncateLogPayload = (
  payload: any,
  maxSizeKB: number = 180,
  knownSizeKB?: number,
): any => {
  const originalSizeKB = knownSizeKB ?? getSizeKB(payload);
  if (originalSizeKB <= maxSizeKB) return payload;

  // Pass 1 — normal limits
  let result = truncateRecursive(payload, 0, NORMAL_LIMITS);
  let truncatedSizeKB = getSizeKB(result);
  let truncationMode = "normal";

  // Pass 2 — aggressive limits (only if still over budget)
  if (truncatedSizeKB > maxSizeKB) {
    result = truncateRecursive(result, 0, AGGRESSIVE_LIMITS);
    truncatedSizeKB = getSizeKB(result);
    truncationMode = "aggressive";
  }

  // Pass 3 (safety net) — still over budget after recursive passes.
  // Collapse every nested field to a structural summary — always produces a tiny result.
  if (truncatedSizeKB > maxSizeKB) {
    result = forceTopLevelSummary(result);
    truncatedSizeKB = getSizeKB(result);
    truncationMode = "structural-summary";
  }

  result._wasTruncated = true;
  result._truncationMode = truncationMode;
  result._originalSizeKB = parseFloat(originalSizeKB.toFixed(2));
  result._truncatedSizeKB = parseFloat(truncatedSizeKB.toFixed(2));
  return result;
};
