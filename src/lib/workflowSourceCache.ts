const KEY = "vizu-four:workflow-sources";
const MAX_ENTRIES = 20;

interface Entry {
  hash: string;
  yaml: string;
}

/** Minimal slice of the Storage API, so tests can pass a fake (matches the
 * same shape debugPrefs.ts uses). */
export interface SourceCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SourceCacheStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(storage: SourceCacheStorage): Entry[] {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Entry => typeof e === "object" && e !== null && typeof e.hash === "string" && typeof e.yaml === "string"
    );
  } catch {
    return [];
  }
}

/**
 * Remembers the exact text a workflow session was created from, keyed by
 * the same content hash `SessionView.workflowHash` already exposes - the
 * one place in the app that ever sees the raw YAML the user pasted (the
 * server discards it after parsing). This is what makes "Share this
 * session" possible without threading the raw source through the engine
 * and every session route: as long as the session was created in this
 * browser, its text is right here.
 *
 * Capped at a small number of entries (oldest evicted first) so a long-
 * lived tab that's paged through many example workflows doesn't grow this
 * without bound.
 */
export function saveWorkflowSource(
  hash: string,
  yaml: string,
  storage: SourceCacheStorage | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    const entries = readAll(storage).filter((e) => e.hash !== hash);
    entries.push({ hash, yaml });
    while (entries.length > MAX_ENTRIES) entries.shift();
    storage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage blocked - sharing just won't be available.
  }
}

export function loadWorkflowSource(
  hash: string,
  storage: SourceCacheStorage | null = defaultStorage()
): string | null {
  if (!storage) return null;
  try {
    return readAll(storage).find((e) => e.hash === hash)?.yaml ?? null;
  } catch {
    return null;
  }
}
