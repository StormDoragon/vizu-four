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
  // A real working tree the user opted into debugging against is never
  // ours to delete - only the disposable mkdtemp scratch dir is.
  if (!session.usesRealWorkspace) {
    await fs.rm(session.workspaceDir, { recursive: true, force: true }).catch(() => {});
  }
  // Reclaims every lane's $RUNNER_TEMP dir, the shared tool_cache dir, and
  // the artifact-simulation scratch space in one shot, since they all live
  // under this session's temp root regardless of workspace mode.
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
/**
 * Admission slots held between "this request may create a session" and the
 * session actually landing in the store.
 *
 * The two live-session caps used to be checked and then awaited across -
 * the workspace mkdtemp sits between the check and the save - so any number
 * of concurrent requests could pass the same check before the first of them
 * counted for anything. Reserving synchronously closes that window: the
 * check and the increment happen in one turn of the event loop, with no
 * await between them.
 */
const RESERVATION_KEY = "__actionsDebuggerSessionReservations__";

interface Reservations {
  total: number;
  byOwner: Map<string, number>;
}

function reservations(): Reservations {
  const g = globalThis as unknown as Record<string, Reservations | undefined>;
  if (!g[RESERVATION_KEY]) g[RESERVATION_KEY] = { total: 0, byOwner: new Map() };
  return g[RESERVATION_KEY]!;
}

export type AdmissionRefusal = "owner" | "total";

/**
 * Takes a slot for a session about to be created, or names the cap that
 * refused it. Must be released once the session is saved (from then on the
 * store itself counts it) or the attempt has failed.
 */
export function reserveSessionSlot(
  ownerId: string,
  maxPerOwner: number,
  maxTotal: number
): AdmissionRefusal | null {
  const held = reservations();
  if (countSessionsByOwner(ownerId) + (held.byOwner.get(ownerId) ?? 0) >= maxPerOwner) {
    return "owner";
  }
  if (getStore().size + held.total >= maxTotal) return "total";
  held.total++;
  held.byOwner.set(ownerId, (held.byOwner.get(ownerId) ?? 0) + 1);
  return null;
}

export function releaseSessionSlot(ownerId: string): void {
  const held = reservations();
  held.total = Math.max(0, held.total - 1);
  const forOwner = (held.byOwner.get(ownerId) ?? 0) - 1;
  if (forOwner > 0) held.byOwner.set(ownerId, forOwner);
  else held.byOwner.delete(ownerId);
}

/** Test seam. */
export function resetSessionSlots(): void {
  const held = reservations();
  held.total = 0;
  held.byOwner.clear();
}

export function countSessionsByOwner(ownerId: string): number {
  let count = 0;
  for (const session of getStore().values()) {
    if (session.ownerId === ownerId) count++;
  }
  return count;
}
