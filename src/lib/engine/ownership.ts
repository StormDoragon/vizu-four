import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getSession } from "./store";
import type { DebugSession } from "./types";

export const OWNER_COOKIE = "vizu_owner";

/** Long enough to outlive a browser restart; sessions themselves are reaped
 * after a couple of hours idle, so this only needs to outlive those. */
const OWNER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Whether this visitor may touch this session.
 *
 * Pure and exported so the rule is unit-testable on its own - the routes
 * below are the only enforcement point, and a subtly wrong predicate here
 * would silently open every one of them.
 */
export function isOwner(session: DebugSession, ownerId: string | null | undefined): boolean {
  return typeof ownerId === "string" && ownerId.length > 0 && session.ownerId === ownerId;
}

export async function readOwnerId(): Promise<string | null> {
  const store = await cookies();
  return store.get(OWNER_COOKIE)?.value ?? null;
}

/** Returns this visitor's owner id, minting and setting one if they have
 * none yet. Only session creation needs to call this. */
export async function ensureOwnerId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(OWNER_COOKIE)?.value;
  if (existing) return existing;

  const ownerId = randomUUID();
  store.set(OWNER_COOKIE, ownerId, {
    // The browser sends it automatically; no client code needs to read it,
    // so keep it out of reach of any script.
    httpOnly: true,
    // Blocks the cookie on cross-site POSTs, which is what would otherwise
    // let another origin drive a session whose id it had somehow learned.
    sameSite: "lax",
    // localhost dev is plain http, where a Secure cookie would never be set.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OWNER_COOKIE_MAX_AGE_SECONDS,
  });
  return ownerId;
}

/**
 * The single gate every `[id]` route goes through.
 *
 * Returns null both for "no such session" and "not yours", so callers answer
 * 404 in both cases: a 403 would confirm that an id exists, turning any
 * probe into an oracle. Routing both through one helper is deliberate -
 * per-route checks are the kind of thing that gets forgotten when a tenth
 * route is added.
 */
export async function getOwnedSession(id: string): Promise<DebugSession | null> {
  const session = getSession(id);
  if (!session) return null;
  return isOwner(session, await readOwnerId()) ? session : null;
}
