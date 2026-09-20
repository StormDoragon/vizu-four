import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_BUDGET_WINDOW_MS,
  acquireAiCall,
  aiBudgetUsage,
  callTimeoutMs,
  maxCallsPerWindow,
  maxConcurrentCalls,
  resetAiBudget,
} from "./budget";

beforeEach(() => resetAiBudget());
afterEach(() => {
  vi.unstubAllEnvs();
  resetAiBudget();
});

/** Takes `n` leases, asserting each was granted, and returns them. */
function take(n: number, now?: number) {
  return Array.from({ length: n }, () => {
    const lease = acquireAiCall(now);
    expect(typeof lease).not.toBe("string");
    return lease as { release: () => void };
  });
}

describe("concurrency", () => {
  it("refuses once the in-flight limit is reached", () => {
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "2");
    take(2);
    expect(acquireAiCall()).toBe("concurrency");
  });

  it("frees the slot when a lease is released", () => {
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "2");
    const leases = take(2);
    expect(acquireAiCall()).toBe("concurrency");
    leases[0].release();
    expect(typeof acquireAiCall()).not.toBe("string");
  });

  it("ignores a double release, so one caller cannot inflate the pool", () => {
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "2");
    const leases = take(2);
    leases[0].release();
    leases[0].release();
    expect(aiBudgetUsage().inFlight).toBe(1);
  });
});

describe("spend window", () => {
  it("refuses once the window's calls are spent, even with nothing in flight", () => {
    vi.stubEnv("VIZU_AI_MAX_CALLS_PER_WINDOW", "3");
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "100");
    for (const lease of take(3)) lease.release();
    expect(aiBudgetUsage().inFlight).toBe(0);
    // Releasing returns concurrency, not budget - that is the whole point of
    // counting them separately.
    expect(acquireAiCall()).toBe("rate");
  });

  it("counts a call when it starts, not when it finishes", () => {
    // Otherwise a burst of concurrent requests all pass the same check
    // before any of them has counted.
    vi.stubEnv("VIZU_AI_MAX_CALLS_PER_WINDOW", "5");
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "100");
    take(5);
    expect(aiBudgetUsage().calls).toBe(5);
    expect(acquireAiCall()).toBe("rate");
  });

  it("lets the window slide", () => {
    vi.stubEnv("VIZU_AI_MAX_CALLS_PER_WINDOW", "2");
    const now = 1_000_000;
    for (const lease of take(2, now)) lease.release();
    expect(acquireAiCall(now)).toBe("rate");
    expect(typeof acquireAiCall(now + AI_BUDGET_WINDOW_MS + 1)).not.toBe("string");
  });
});

describe("configuration", () => {
  it("has bounded defaults when nothing is configured", () => {
    expect(maxCallsPerWindow()).toBe(200);
    expect(maxConcurrentCalls()).toBe(4);
    expect(callTimeoutMs()).toBe(20_000);
  });

  it("reads overrides from the environment", () => {
    vi.stubEnv("VIZU_AI_MAX_CALLS_PER_WINDOW", "7");
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "9");
    vi.stubEnv("VIZU_AI_TIMEOUT_MS", "1234");
    expect(maxCallsPerWindow()).toBe(7);
    expect(maxConcurrentCalls()).toBe(9);
    expect(callTimeoutMs()).toBe(1234);
  });

  it("falls back to the default rather than removing the bound on junk input", () => {
    // A typo in the deployment config must not read as "unlimited".
    for (const bad of ["0", "-5", "lots", ""]) {
      vi.stubEnv("VIZU_AI_MAX_CALLS_PER_WINDOW", bad);
      expect(maxCallsPerWindow()).toBe(200);
    }
  });
});
