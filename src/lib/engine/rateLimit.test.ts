import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SESSIONS_PER_WINDOW,
  RATE_WINDOW_MS,
  checkCreateLimit,
  resetRateLimits,
} from "./rateLimit";

describe("checkCreateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows creations up to the limit", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) {
      expect(checkCreateLimit("owner", 1000).allowed).toBe(true);
    }
  });

  it("refuses the one past the limit and says how long to wait", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("owner", 1000);
    const refused = checkCreateLimit("owner", 1000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(RATE_WINDOW_MS / 1000);
  });

  it("keeps visitors independent of each other", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("noisy", 1000);
    expect(checkCreateLimit("noisy", 1000).allowed).toBe(false);
    expect(checkCreateLimit("quiet", 1000).allowed).toBe(true);
  });

  it("lets the budget recover as hits age out of the window", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("owner", 1000);
    expect(checkCreateLimit("owner", 1000).allowed).toBe(false);
    // One millisecond past the window, the first hit no longer counts.
    expect(checkCreateLimit("owner", 1000 + RATE_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("slides rather than resetting, so the budget can't be spent twice at a boundary", () => {
    // Spend the whole budget late in a window...
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("owner", 1000);
    // ...and a fixed-window limiter would hand out a fresh budget here.
    // A sliding one still refuses, because those hits are still in range.
    expect(checkCreateLimit("owner", 1000 + RATE_WINDOW_MS - 1).allowed).toBe(false);
  });

  it("counts down the retry hint as the window advances", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("owner", 0);
    const early = checkCreateLimit("owner", 0).retryAfterSeconds;
    const later = checkCreateLimit("owner", 60_000).retryAfterSeconds;
    expect(later).toBeLessThan(early);
    expect(later).toBeGreaterThan(0);
  });
});
