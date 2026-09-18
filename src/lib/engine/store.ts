import type { DebugSession } from "./types";

// Stashed on `globalThis` so the singleton survives Next.js dev-mode module
// re-evaluation (Fast Refresh can otherwise create a second, empty store).
const GLOBAL_KEY = "__actionsDebuggerSessionStore__";

function getStore(): Map<string, DebugSession> {
  const g = globalThis as unknown as Record<string, Map<string, DebugSession> | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

export function saveSession(session: DebugSession): void {
  getStore().set(session.id, session);
}

export function getSession(id: string): DebugSession | undefined {
  return getStore().get(id);
}

export function deleteSession(id: string): boolean {
  return getStore().delete(id);
}

export function listSessions(): DebugSession[] {
  return [...getStore().values()];
}
