import type { SessionView } from "./engine/serialize";

const KEY_PREFIX = "vizu-four:debug-prefs:";
const VERSION = 1;

/**
 * `GITHUB_TOKEN` is seeded into every session's config automatically (see
 * defaultRunConfig), so persisting it would just re-add a name the next
 * session already has.
 */
const AUTO_SEEDED_SECRETS = new Set(["GITHUB_TOKEN"]);

/**
 * What survives between sessions for a given workflow.
 *
 * Deliberately **no secret values**. The browser never receives them in the
 * first place - `SessionView.config` exposes only `secretNames` - and the
 * documented security model is that What-If secrets never leave the server
 * process and are never written to disk. localStorage is disk. Names are
 * persisted so the rows reappear as prompts to re-enter, which is safe:
 * they're generally already visible in the workflow source the user pasted.
 */
export interface DebugPrefs {
  version: number;
  breakpoints: string[];
  envOverrides: Record<string, string>;
  vars: Record<string, string>;
  /** Names only - never values. */
  secretNames: string[];
  breakOnFailure: boolean;
}

/** Minimal slice of the Storage API, so tests can pass a fake. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): PrefsStorage | null {
  try {
    // Absent during SSR, and access can throw outright when site data is
    // blocked, so every caller treats persistence as best-effort.
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function prefsKey(workflowHash: string): string {
  return `${KEY_PREFIX}${workflowHash}`;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "string")
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Parses stored JSON defensively - anything hand-edited, truncated, or
 * written by a future version is discarded rather than half-applied. */
export function parsePrefs(raw: string | null): DebugPrefs | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (p.version !== VERSION) return null;
  if (!isStringArray(p.breakpoints)) return null;
  if (!isStringRecord(p.envOverrides)) return null;
  if (!isStringRecord(p.vars)) return null;
  if (!isStringArray(p.secretNames)) return null;
  if (typeof p.breakOnFailure !== "boolean") return null;
  return {
    version: VERSION,
    breakpoints: p.breakpoints,
    envOverrides: p.envOverrides,
    vars: p.vars,
    secretNames: p.secretNames,
    breakOnFailure: p.breakOnFailure,
  };
}

export function loadPrefs(
  workflowHash: string,
  storage: PrefsStorage | null = defaultStorage()
): DebugPrefs | null {
  if (!storage) return null;
  try {
    return parsePrefs(storage.getItem(prefsKey(workflowHash)));
  } catch {
    return null;
  }
}

export function savePrefs(
  workflowHash: string,
  prefs: DebugPrefs,
  storage: PrefsStorage | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(prefsKey(workflowHash), JSON.stringify(prefs));
  } catch {
    // Quota exceeded or storage blocked - persistence is a convenience.
  }
}

export function clearPrefs(
  workflowHash: string,
  storage: PrefsStorage | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(prefsKey(workflowHash));
  } catch {
    // Nothing to do; see savePrefs.
  }
}

/** Snapshot of the persistable parts of a live session. */
export function prefsFromSession(session: SessionView): DebugPrefs {
  return {
    version: VERSION,
    breakpoints: [...session.breakpoints],
    envOverrides: { ...session.config.envOverrides },
    vars: { ...session.config.vars },
    secretNames: session.config.secretNames.filter((n) => !AUTO_SEEDED_SECRETS.has(n)),
    breakOnFailure: session.breakOnFailure,
  };
}

/** True when nothing worth keeping has been set yet, so restoring into this
 * session can't clobber work in progress (e.g. a mid-debug page reload,
 * where the server already holds the real state). */
export function isPristine(session: SessionView): boolean {
  return (
    session.breakpoints.length === 0 &&
    Object.keys(session.config.envOverrides).length === 0 &&
    Object.keys(session.config.vars).length === 0
  );
}

/**
 * Drops stored breakpoints whose job or step no longer exists. The hash key
 * already means a changed workflow gets a clean slate, so this only matters
 * if the stored shape outlives a change to how step keys are generated -
 * cheap insurance against silently attaching a breakpoint to the wrong step.
 */
export function restorableBreakpoints(prefs: DebugPrefs, session: SessionView): string[] {
  const valid = new Set<string>();
  for (const job of Object.values(session.workflow.jobs)) {
    for (const step of job.steps) valid.add(`${job.id}:${step.key}`);
  }
  return prefs.breakpoints.filter((b) => valid.has(b));
}

/** Splits a stored `${jobId}:${stepKey}` breakpoint back into its parts.
 * Job ids can't contain ':', so the first separator is the boundary. */
export function splitBreakpoint(breakpoint: string): { jobId: string; stepKey: string } | null {
  const idx = breakpoint.indexOf(":");
  if (idx <= 0 || idx === breakpoint.length - 1) return null;
  return { jobId: breakpoint.slice(0, idx), stepKey: breakpoint.slice(idx + 1) };
}
