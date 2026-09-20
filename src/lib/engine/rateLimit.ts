/**
 * Limits on session creation.
 *
 * Creating a session allocates a temp directory and an in-memory record that
 * accumulates captured output, so an unbounded loop is the cheapest way to
 * exhaust a deployment. These limits are enforced **always**, not only in
 * simulation-only mode: a control that is off by default in local use is a
 * control nobody notices is broken. They're set high enough that a person
 * clicking around locally will never reach them.
 *
 * Three scopes, because the owner id is a cookie the visitor controls -
 * clearing it buys a fresh allowance, so it cannot be the only thing
 * standing between one client and the whole process. The address scope is
 * harder to shed (and deliberately looser, since a NAT shares one), and the
 * global scope bounds the shared instance no matter how many identities the
 * traffic is spread across.
 */

export const MAX_SESSIONS_PER_WINDOW = 30;
export const MAX_SESSIONS_PER_ADDRESS_PER_WINDOW = 60;
export const MAX_SESSIONS_GLOBAL_PER_WINDOW = 500;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_LIVE_SESSIONS_PER_OWNER = 25;
export const MAX_LIVE_SESSIONS_TOTAL = 200;

const GLOBAL_KEY = "__actionsDebuggerRateLimit__";

interface Bucket {
  /** Creation timestamps inside the current window, oldest first. */
  hits: number[];
}

interface State {
  buckets: Map<string, Bucket>;
  lastSweepAt: number;
}

function state(): State {
  const g = globalThis as unknown as Record<string, State | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { buckets: new Map(), lastSweepAt: 0 };
  return g[GLOBAL_KEY]!;
}

/**
 * Drops buckets with nothing left inside the window.
 *
 * Without this the map keeps one entry per owner id ever seen, and owner ids
 * are minted per visitor - on a long-running single process (which is what
 * this app needs, see DEPLOY.md) that grows without bound. Runs at most once
 * per window: the cost is proportional to the map, not to the request.
 */
function sweep(s: State, now: number): void {
  if (now - s.lastSweepAt < RATE_WINDOW_MS) return;
  s.lastSweepAt = now;
  const cutoff = now - RATE_WINDOW_MS;
  for (const [key, bucket] of s.buckets) {
    const live = bucket.hits.filter((t) => t > cutoff);
    if (live.length === 0) s.buckets.delete(key);
    else bucket.hits = live;
  }
}

export type LimitScope = "owner" | "address" | "global";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest hit falls out of the window. Only meaningful
   * when `allowed` is false. */
  retryAfterSeconds: number;
  /** Which limit refused. Only set when `allowed` is false. */
  scope?: LimitScope;
}

/**
 * The address the nearest proxy reported, if any.
 *
 * Taking the last `x-forwarded-for` entry means a client cannot help itself
 * by prepending entries. That is only as good as the deployment, though:
 * it assumes a proxy that always appends or overwrites the last entry and
 * that nothing can reach this process around it. Behind a longer chain the
 * last entry may also be an intermediary shared by many visitors, which
 * makes the address scope coarser than intended.
 *
 * So treat the address scope as a conditional limit, not a guarantee - the
 * global scope is the one that bounds this process regardless of what any
 * header says. Null when the header is absent, as on a direct connection,
 * where the address scope is skipped rather than guessed at.
 */
export function clientAddressFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const parts = forwarded
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function liveHits(s: State, key: string, now: number): number[] {
  const cutoff = now - RATE_WINDOW_MS;
  const bucket = s.buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => t > cutoff);
  return bucket.hits;
}

/**
 * Sliding window rather than a fixed one: a fixed window lets a caller spend
 * the whole budget at the end of one window and again at the start of the
 * next, which is twice the intended rate at exactly the wrong moment.
 *
 * `now` is injectable so the window behaviour can be tested without waiting
 * ten minutes.
 */
export function checkCreateLimit(
  ownerId: string,
  clientAddress: string | null = null,
  now: number = Date.now()
): RateLimitResult {
  const s = state();
  sweep(s, now);

  const scopes: { scope: LimitScope; key: string; limit: number }[] = [
    { scope: "owner", key: `owner:${ownerId}`, limit: MAX_SESSIONS_PER_WINDOW },
    { scope: "global", key: "global", limit: MAX_SESSIONS_GLOBAL_PER_WINDOW },
  ];
  if (clientAddress) {
    scopes.splice(1, 0, {
      scope: "address",
      key: `addr:${clientAddress}`,
      limit: MAX_SESSIONS_PER_ADDRESS_PER_WINDOW,
    });
  }

  // Capacity is checked across every scope before any of them records a hit,
  // so a request refused by one doesn't spend another's budget on the way.
  for (const { scope, key, limit } of scopes) {
    const hits = liveHits(s, key, now);
    if (hits.length >= limit) {
      s.buckets.set(key, { hits });
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + RATE_WINDOW_MS - now) / 1000)),
        scope,
      };
    }
  }

  for (const { key } of scopes) {
    const hits = liveHits(s, key, now);
    hits.push(now);
    s.buckets.set(key, { hits });
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam - the bucket map lives on globalThis to survive dev reloads. */
export function resetRateLimits(): void {
  const s = state();
  s.buckets.clear();
  s.lastSweepAt = 0;
}

/** Test seam: how many buckets are currently retained. */
export function rateLimitBucketCount(): number {
  return state().buckets.size;
}
