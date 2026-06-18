#!/usr/bin/env tsx
/**
 * Read-only validator for atlas.world.json.
 *
 * Checks (see README.md):
 *   1. Parses as JSON and conforms to atlas.world.schema.json.
 *   2. No dangling labels — every "kind:name" string referenced anywhere
 *      (connects, typed ref arrays, relations[].to, journeys[].beats[].node)
 *      exists as a key in `nodes`.
 *   3. index/node consistency — index and nodes have the same keys, and
 *      index[label].connects deep-equals nodes[label].connects.
 *   4. Label well-formedness — every key matches `kind:name` grammar and
 *      nodes[label].kind matches the prefix.
 *
 * Never writes. Exits non-zero on any failure.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";

const here = dirname(fileURLToPath(import.meta.url));
const worldPath = join(here, "atlas.world.json");
const schemaPath = join(here, "atlas.world.schema.json");

const errors: string[] = [];

const world = JSON.parse(readFileSync(worldPath, "utf-8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

// --- 1. Schema conformance ---------------------------------------------
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);
if (!validateSchema(world)) {
  for (const err of validateSchema.errors ?? []) {
    errors.push(`[schema] ${err.instancePath || "/"} ${err.message}`);
  }
}

const KIND_PREFIX: Record<string, string> = {
  feature: "feature",
  module: "module",
  entity: "entity",
  route: "route",
  external: "ext",
  queue: "queue",
};

const LABEL_RE = /^(feature|module|entity|route|ext|queue|journey):.+/;

const nodeKeys: string[] = Object.keys(world.nodes ?? {});
const indexKeys: string[] = Object.keys(world.index ?? {});
const nodeKeySet = new Set(nodeKeys);

// --- 4. Label well-formedness -------------------------------------------
for (const key of nodeKeys) {
  if (!LABEL_RE.test(key)) {
    errors.push(`[label] nodes key "${key}" does not match kind:name grammar`);
    continue;
  }
  const prefix = key.split(":")[0];
  const node = world.nodes[key];
  const expectedKind = Object.entries(KIND_PREFIX).find(([, p]) => p === prefix)?.[0];
  if (node.kind !== expectedKind) {
    errors.push(
      `[label] nodes["${key}"].kind is "${node.kind}", expected "${expectedKind}" for prefix "${prefix}"`,
    );
  }
}
for (const key of indexKeys) {
  if (!LABEL_RE.test(key)) {
    errors.push(`[label] index key "${key}" does not match kind:name grammar`);
  }
}

// --- 3. index/node consistency -------------------------------------------
const missingInIndex = nodeKeys.filter((k) => !indexKeys.includes(k));
const missingInNodes = indexKeys.filter((k) => !nodeKeys.includes(k));
for (const k of missingInIndex) errors.push(`[index] "${k}" is in nodes but missing from index`);
for (const k of missingInNodes) errors.push(`[index] "${k}" is in index but missing from nodes`);

for (const key of nodeKeys) {
  if (!world.index[key]) continue;
  const nodeConnects: string[] = world.nodes[key].connects ?? [];
  const indexConnects: string[] = world.index[key].connects ?? [];
  const a = [...nodeConnects].sort();
  const b = [...indexConnects].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    errors.push(
      `[index] "${key}".connects mismatch — nodes: [${a.join(", ")}] vs index: [${b.join(", ")}]`,
    );
  }
}

// --- 2. No dangling labels -------------------------------------------------
function collectLabels(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    if (LABEL_RE.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectLabels(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectLabels(v, out);
  }
}

for (const key of nodeKeys) {
  const referenced = new Set<string>();
  collectLabels(world.nodes[key], referenced);
  for (const label of referenced) {
    if (label.startsWith("journey:")) continue; // journeys are not addressable from nodes
    if (!nodeKeySet.has(label)) {
      errors.push(`[dangling] nodes["${key}"] references unknown label "${label}"`);
    }
  }
}

for (const [jKey, journey] of Object.entries<any>(world.journeys ?? {})) {
  if (!LABEL_RE.test(jKey) || !jKey.startsWith("journey:")) {
    errors.push(`[label] journeys key "${jKey}" does not match journey:name grammar`);
  }
  for (const beat of journey.beats ?? []) {
    if (!nodeKeySet.has(beat.node)) {
      errors.push(`[dangling] journeys["${jKey}"] beat references unknown node "${beat.node}"`);
    }
  }
}

// --- Report ----------------------------------------------------------------
if (errors.length > 0) {
  console.error(`atlas.world.json: ${errors.length} error(s)\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `atlas.world.json OK — ${nodeKeys.length} nodes, ${Object.keys(world.journeys ?? {}).length} journeys`,
);
