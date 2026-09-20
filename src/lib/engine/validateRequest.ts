import type { RunConfig } from "./types";

/** Comfortably larger than any real workflow file; guards against an
 * absurdly large payload being parsed, stored, and repeatedly re-serialized. */
export const MAX_WORKFLOW_YAML_LENGTH = 1_000_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return isPlainObject(v) && Object.values(v).every((x) => typeof x === "string");
}

const STRING_FIELDS: (keyof RunConfig)[] = [
  "eventName",
  "ref",
  "sha",
  "actor",
  "repository",
  "runId",
  "runNumber",
];
const STRING_MAP_FIELDS: (keyof RunConfig)[] = ["vars", "secrets", "envOverrides"];

/**
 * A hand-rolled boundary check for the one place untrusted input enters the
 * engine. `config: Partial<RunConfig>` was previously spread into the
 * session's config unvalidated - e.g. `vars: "oops"` (a string instead of a
 * record) would reach `Object.entries` deep in the engine and 500, instead
 * of failing here with a clear message.
 */
export function validateRunConfigPatch(config: unknown): string | null {
  if (config === undefined) return null;
  if (!isPlainObject(config)) return "'config' must be an object";

  for (const field of STRING_FIELDS) {
    const value = config[field];
    if (value !== undefined && typeof value !== "string") {
      return `'config.${field}' must be a string`;
    }
  }
  for (const field of STRING_MAP_FIELDS) {
    const value = config[field];
    if (value !== undefined && !isStringRecord(value)) {
      return `'config.${field}' must be an object with only string values`;
    }
  }
  if (config.workflowInputs !== undefined && !isPlainObject(config.workflowInputs)) {
    return "'config.workflowInputs' must be an object";
  }

  // Size, not just shape: a session created with a huge config was as
  // unbounded as one grown into that state a patch at a time.
  for (const field of [...STRING_MAP_FIELDS, "workflowInputs" as const]) {
    const value = config[field];
    if (!isPlainObject(value)) continue;
    const tooBig = configMapSizeError(value, `config.${field}`);
    if (tooBig) return tooBig;
  }
  return null;
}

/**
 * Bounds on the *accumulated* configuration of one session.
 *
 * The per-patch limits below bound a single request, which is not the same
 * thing: every accepted patch adds to state that lives for the session's
 * lifetime, so repeating a request that is individually legal grows one
 * session without creating another. Twelve 200-key patches were accepted and
 * left 2,400 keys and 2.4MB behind, and nothing stopped the thirteenth.
 *
 * Applied to the configuration a session *would* have, so a patch that only
 * removes keys is always allowed - otherwise a session that reached the
 * limit could never be brought back under it.
 *
 * The same limits apply to the configuration a session is created with,
 * which previously had no size check at all.
 */
export const MAX_CONFIG_KEYS = 1_000;
export const MAX_CONFIG_CHARS = 2_000_000;

export function configMapSizeError(
  map: Record<string, unknown>,
  field: string
): string | null {
  const keys = Object.keys(map);
  if (keys.length > MAX_CONFIG_KEYS) {
    return `'${field}' would hold more than ${MAX_CONFIG_KEYS} keys in this session`;
  }
  let chars = 0;
  for (const [key, value] of Object.entries(map)) {
    chars += key.length + (typeof value === "string" ? value.length : JSON.stringify(value ?? null).length);
    if (chars > MAX_CONFIG_CHARS) {
      return `'${field}' would hold more than ${MAX_CONFIG_CHARS} characters in this session`;
    }
  }
  return null;
}

/** Bounds on a What-If patch. Overrides live for the session's lifetime and
 * are resolved into every later step's environment, so an unbounded payload
 * is a way to grow one session's memory without creating another. */
const MAX_WHATIF_KEYS = 200;
const MAX_WHATIF_VALUE_LENGTH = 100_000;

function isNullableStringRecord(v: unknown): v is Record<string, string | null> {
  return isPlainObject(v) && Object.values(v).every((x) => x === null || typeof x === "string");
}

function oversizedEntry(record: Record<string, unknown>, field: string): string | null {
  const keys = Object.keys(record);
  if (keys.length > MAX_WHATIF_KEYS) {
    return `'${field}' has more than ${MAX_WHATIF_KEYS} keys`;
  }
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.length > MAX_WHATIF_VALUE_LENGTH) {
      return `'${field}.${key}' exceeds the ${MAX_WHATIF_VALUE_LENGTH}-character limit`;
    }
  }
  return null;
}

/**
 * The same boundary check as above for the What-If route, which previously
 * passed its parsed JSON straight into `applyWhatIf`. TypeScript's
 * `WhatIfPatch` describes what the engine expects, not what arrives over
 * HTTP: a number where a string belongs travelled all the way to a string
 * operation deep in interpolation before anything noticed.
 */
export function validateWhatIfPatch(patch: unknown): string | null {
  if (!isPlainObject(patch)) return "Request body must be an object";

  for (const field of ["env", "vars", "secrets"] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (!isNullableStringRecord(value)) {
      return `'${field}' must be an object whose values are strings or null`;
    }
    const tooBig = oversizedEntry(value, field);
    if (tooBig) return tooBig;
  }

  if (patch.inputs !== undefined) {
    if (!isPlainObject(patch.inputs)) return "'inputs' must be an object";
    const tooBig = oversizedEntry(patch.inputs, "inputs");
    if (tooBig) return tooBig;
  }

  for (const field of ["eventName", "ref"] as const) {
    const value = patch[field];
    if (value !== undefined && typeof value !== "string") {
      return `'${field}' must be a string`;
    }
    if (typeof value === "string" && value.length > MAX_WHATIF_VALUE_LENGTH) {
      return `'${field}' exceeds the ${MAX_WHATIF_VALUE_LENGTH}-character limit`;
    }
  }

  if (patch.breakOnFailure !== undefined && typeof patch.breakOnFailure !== "boolean") {
    return "'breakOnFailure' must be a boolean";
  }
  return null;
}
