/**
 * Per-visitor limits on session creation.
 *
 * Creating a session allocates a temp directory and an in-memory record that
 * accumulates captured output, so an unbounded loop is the cheapest way to
 * exhaust a deployment. These limits are enforced **always**, not only in
 * simulation-only mode: a control that is off by default in local use is a
 * control nobody notices is broken. They're set high enough that a person
 * clicking around locally will never reach them.
 */

export const MAX_SESSIONS_PER_WINDOW = 30;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_LIVE_SESSIONS_PER_OWNER = 25;

const GLOBAL_KEY = "__actionsDebuggerRateLimit__";

interface Bucket {
  /** Creation timestamps inside the current window, oldest first. */
  hits: number[];
}

function buckets(): Map<string, Bucket> {
  const g = globalThis as unknown as Record<string, Map<string, Bucket> | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest hit falls out of the window. Only meaningful
   * when `allowed` is false. */
  retryAfterSeconds: number;
}

/**
 * Sliding window rather than a fixed one: a fixed window lets a caller spend
 * the whole budget at the end of one window and again at the start of the
 * next, which is twice the intended rate at exactly the wrong moment.
 *
 * `now` is injectable so the window behaviour can be tested without waiting
 * ten minutes.
 */
export function checkCreateLimit(ownerId: string, now: number = Date.now()): RateLimitResult {
  const map = buckets();
  const bucket = map.get(ownerId) ?? { hits: [] };
  const cutoff = now - RATE_WINDOW_MS;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= MAX_SESSIONS_PER_WINDOW) {
    map.set(ownerId, bucket);
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000)),
    };
  }

  bucket.hits.push(now);
  map.set(ownerId, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam - the bucket map lives on globalThis to survive dev reloads. */
export function resetRateLimits(): void {
  buckets().clear();
}
