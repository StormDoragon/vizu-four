/**
 * Spend and concurrency budget for live Claude calls.
 *
 * The explanation endpoint is the one place this app can spend the
 * operator's money, and it had no bound of any kind: with
 * `ANTHROPIC_API_KEY` set, every request reached the provider, so anyone who
 * could reach the demo could drive the bill and the only limit was how fast
 * they could send requests.
 *
 * Three separate things are bounded, because they fail differently:
 *
 *   calls per window  - the actual spend cap
 *   concurrent calls  - a burst can otherwise hold open as many sockets and
 *                       as much memory as it likes, whatever the spend cap
 *                       says, since none of them have completed yet
 *   per-call timeout  - a hung request would otherwise occupy one of those
 *                       slots indefinitely, turning a provider outage into
 *                       an outage here
 *
 * Exhausting the budget is not an error. A live explanation is an optional
 * upgrade over the offline heuristics, so the caller falls back to those and
 * the feature keeps working - just without spending.
 *
 * All three are env-configurable so an operator who wants a different
 * exposure does not have to fork the code. The defaults are sized for a
 * single shared demo instance.
 */

export const AI_BUDGET_WINDOW_MS = 10 * 60 * 1000;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Live Claude calls allowed per window across the whole instance. */
export function maxCallsPerWindow(): number {
  return positiveIntFromEnv("VIZU_AI_MAX_CALLS_PER_WINDOW", 200);
}

/** Claude calls allowed to be in flight at once. */
export function maxConcurrentCalls(): number {
  return positiveIntFromEnv("VIZU_AI_MAX_CONCURRENT", 4);
}

/** How long a single Claude call may take before it is abandoned. */
export function callTimeoutMs(): number {
  return positiveIntFromEnv("VIZU_AI_TIMEOUT_MS", 20_000);
}

const GLOBAL_KEY = "__actionsDebuggerAiBudget__";

interface BudgetState {
  /** Start times of calls inside the current window, oldest first. */
  calls: number[];
  inFlight: number;
}

function state(): BudgetState {
  const g = globalThis as unknown as Record<string, BudgetState | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { calls: [], inFlight: 0 };
  return g[GLOBAL_KEY]!;
}

export type BudgetRefusal = "rate" | "concurrency";

export interface BudgetLease {
  /** Must be called exactly once, in a `finally`, or the slot leaks. */
  release: () => void;
}

/**
 * Reserves capacity for one call, or explains why it cannot.
 *
 * The window slot is recorded here rather than on completion, so a burst of
 * concurrent requests cannot all pass the same check before any of them
 * counts - the same reservation-before-await shape session creation uses.
 */
export function acquireAiCall(now: number = Date.now()): BudgetLease | BudgetRefusal {
  const s = state();
  const cutoff = now - AI_BUDGET_WINDOW_MS;
  s.calls = s.calls.filter((t) => t > cutoff);

  if (s.calls.length >= maxCallsPerWindow()) return "rate";
  if (s.inFlight >= maxConcurrentCalls()) return "concurrency";

  s.calls.push(now);
  s.inFlight++;
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      s.inFlight = Math.max(0, s.inFlight - 1);
    },
  };
}

/** Test seam, and a way for an operator to clear state after a misconfiguration. */
export function resetAiBudget(): void {
  const s = state();
  s.calls = [];
  s.inFlight = 0;
}

/** Test seam: calls counted in the current window, and how many are in flight. */
export function aiBudgetUsage(now: number = Date.now()): { calls: number; inFlight: number } {
  const s = state();
  const cutoff = now - AI_BUDGET_WINDOW_MS;
  return { calls: s.calls.filter((t) => t > cutoff).length, inFlight: s.inFlight };
}
