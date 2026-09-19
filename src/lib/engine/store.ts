import fs from "node:fs/promises";
import { sessionTempRoot } from "./contexts";
import type { DebugSession } from "./types";

// Stashed on `globalThis` so the singleton survives Next.js dev-mode module
// re-evaluation (Fast Refresh can otherwise create a second, empty store).
const GLOBAL_KEY = "__actionsDebuggerSessionStore__";
const REAPER_KEY = "__actionsDebuggerSessionReaper__";

/**
 * Sessions (and their real mkdtemp'd workspace dirs) previously lived
 * forever - nothing ever called the existing delete path, so every "Start
 * Debugging" leaked memory and a temp directory for the life of the
 * process. Idle sessions past this TTL are reclaimed automatically instead
 * of requiring the client to remember to clean up after itself.
 */
const IDLE_TTL_MS = 2 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function getStore(): Map<string, DebugSession> {
  const g = globalThis as unknown as Record<string, Map<string, DebugSession> | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

async function removeSession(session: DebugSession): Promise<void> {
  await fs.rm(session.workspaceDir, { recursive: true, force: true }).catch(() => {});
  // Reclaims every lane's $RUNNER_TEMP dir and the shared tool_cache dir in
  // one shot, since they all live under this session's temp root.
  await fs.rm(sessionTempRoot(session.id), { recursive: true, force: true }).catch(() => {});
  getStore().delete(session.id);
}

/** Deletes every session (and workspace dir) idle for longer than IDLE_TTL_MS. */
export async function reapStaleSessions(): Promise<void> {
  const cutoff = Date.now() - IDLE_TTL_MS;
  const stale = [...getStore().values()].filter(
    (s) => new Date(s.lastAccessedAt).getTime() < cutoff
  );
  await Promise.all(stale.map(removeSession));
}

function ensureReaperScheduled(): void {
  const g = globalThis as unknown as Record<string, NodeJS.Timeout | undefined>;
  if (g[REAPER_KEY]) return;
  const timer = setInterval(() => {
    reapStaleSessions().catch(() => {});
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  g[REAPER_KEY] = timer;
}

export function saveSession(session: DebugSession): void {
  ensureReaperScheduled();
  getStore().set(session.id, session);
}

export function getSession(id: string): DebugSession | undefined {
  const session = getStore().get(id);
  if (session) session.lastAccessedAt = new Date().toISOString();
  return session;
}

/** Deletes a session and reclaims its on-disk workspace dir, if any. */
export async function deleteSessionAndWorkspace(id: string): Promise<boolean> {
  const session = getStore().get(id);
  if (!session) return false;
  await removeSession(session);
  return true;
}

export function listSessions(): DebugSession[] {
  return [...getStore().values()];
}

/** How many live sessions this visitor currently holds, for the creation cap. */
export function countSessionsByOwner(ownerId: string): number {
  let count = 0;
  for (const session of getStore().values()) {
    if (session.ownerId === ownerId) count++;
  }
  return count;
}
