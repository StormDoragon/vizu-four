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
  return null;
}
