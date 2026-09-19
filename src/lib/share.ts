import type { SessionView } from "./engine/serialize";
import type { StepMock } from "./engine/types";
import type { JsonValue } from "./workflow/types";
import type { MatrixCombo } from "./workflow/matrix";

const VERSION = 1;

export interface ShareLaneProgress {
  jobId: string;
  matrix: MatrixCombo;
  /** The lane's pointer at share time - "how many steps to replay" on the
   * receiving end, not a step key, since nothing has run yet there. */
  stepIndex: number;
}

export interface ShareActiveLane {
  jobId: string;
  matrix: MatrixCombo;
}

/**
 * Everything needed to reconstruct an equivalent session elsewhere.
 *
 * Deliberately **no secrets at all** - not values, not even names. This is
 * stricter than debugPrefs' "names only" localStorage persistence: that
 * stays on the user's own disk, this can end up pasted into a chat or an
 * issue. A recipient who needs a secret re-enters it in What-If, same as
 * anyone restoring a saved session locally.
 */
export interface SharePayload {
  version: number;
  yaml: string;
  /** `${jobId}:${stepKey}` pairs, same format as SessionView.breakpoints. */
  breakpoints: string[];
  env: Record<string, string>;
  vars: Record<string, string>;
  breakOnFailure: boolean;
  /** `${jobId}:${stepKey}` keys, same format as SessionView.mockOutputs. */
  mockOutputs: Record<string, StepMock>;
  /** Every lane that had already advanced past its start when shared - not
   * just the active one - so a multi-job workflow's `needs` chain replays
   * in the right order: a downstream lane can't be stepped until its
   * upstream lanes reach a terminal status, exactly as during normal
   * execution, so progress has to be driven job-by-job as each unblocks
   * rather than jumping straight to the one lane someone was looking at. */
  progress: ShareLaneProgress[];
  /** Which lane (matched by job + matrix combo, same as `progress`) was the
   * steppable one at share time - independent of `progress`, since a lane
   * can be selected as active with its pointer still at 0. */
  activeLane: ShareActiveLane | null;
}

/** Snapshot of the shareable parts of a live session, paired with the raw
 * YAML it was created from (the server itself never keeps that text - see
 * workflowSourceCache.ts for where the caller gets it). */
export function buildSharePayload(session: SessionView, yaml: string): SharePayload {
  const lanes = session.laneOrder.map((id) => session.lanes[id]);
  const progress = lanes
    .filter((lane) => lane.pointer > 0)
    .map((lane) => ({ jobId: lane.jobId, matrix: lane.matrix, stepIndex: lane.pointer }));
  const activeLane = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
  return {
    version: VERSION,
    yaml,
    breakpoints: [...session.breakpoints],
    env: { ...session.config.envOverrides },
    vars: { ...session.config.vars },
    breakOnFailure: session.breakOnFailure,
    mockOutputs: { ...session.mockOutputs },
    progress,
    activeLane: activeLane ? { jobId: activeLane.jobId, matrix: activeLane.matrix } : null,
  };
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isJsonRecord(v: unknown): v is Record<string, JsonValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStepMock(v: unknown): v is StepMock {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  if (!isStringRecord(m.outputs)) return false;
  if (m.exitCode !== undefined && typeof m.exitCode !== "number") return false;
  if (m.stderr !== undefined && typeof m.stderr !== "string") return false;
  return true;
}

function isMockOutputsRecord(v: unknown): v is Record<string, StepMock> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every(isStepMock);
}

function isShareLaneProgress(v: unknown): v is ShareLaneProgress {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.jobId === "string" && isJsonRecord(r.matrix) && typeof r.stepIndex === "number";
}

function isProgressArray(v: unknown): v is ShareLaneProgress[] {
  return Array.isArray(v) && v.every(isShareLaneProgress);
}

function isActiveLane(v: unknown): v is ShareActiveLane | null {
  if (v === null) return true;
  if (typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.jobId === "string" && isJsonRecord(r.matrix);
}

/** Parses a decoded payload defensively - a hand-edited, truncated, or
 * future-version token is rejected outright rather than half-applied,
 * matching debugPrefs.parsePrefs's approach to the same problem. */
export function validateSharePayload(parsed: unknown): SharePayload | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (p.version !== VERSION) return null;
  if (typeof p.yaml !== "string" || p.yaml.trim() === "") return null;
  if (!isStringArray(p.breakpoints)) return null;
  if (!isStringRecord(p.env)) return null;
  if (!isStringRecord(p.vars)) return null;
  if (typeof p.breakOnFailure !== "boolean") return null;
  if (!isMockOutputsRecord(p.mockOutputs)) return null;
  if (!isProgressArray(p.progress)) return null;
  if (!isActiveLane(p.activeLane)) return null;
  return {
    version: VERSION,
    yaml: p.yaml,
    breakpoints: p.breakpoints,
    env: p.env,
    vars: p.vars,
    breakOnFailure: p.breakOnFailure,
    mockOutputs: p.mockOutputs,
    progress: p.progress,
    activeLane: p.activeLane,
  };
}

/** URL-safe base64 (RFC 4648 §5) of the payload's JSON, so it can sit
 * directly in a path segment. Encodes as UTF-8 bytes first so a workflow
 * name or step name with non-ASCII characters round-trips correctly. */
export function encodeSharePayload(payload: SharePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of encodeSharePayload. Returns null for anything that isn't a
 * validly-encoded, validly-shaped payload, rather than throwing - a bad or
 * tampered-with link should read as "invalid link," not crash the page. */
export function decodeSharePayload(token: string): SharePayload | null {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return validateSharePayload(JSON.parse(json));
  } catch {
    return null;
  }
}
