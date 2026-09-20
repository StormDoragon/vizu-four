import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_EVALUATIONS_PER_WINDOW,
  MAX_SESSIONS_GLOBAL_PER_WINDOW,
  MAX_SESSIONS_PER_ADDRESS_PER_WINDOW,
  MAX_SESSIONS_PER_WINDOW,
  RATE_WINDOW_MS,
  checkCreateLimit,
  checkEvaluateLimit,
  clientAddressFrom,
  rateLimitBucketCount,
  resetRateLimits,
} from "./rateLimit";

describe("checkCreateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows creations up to the limit", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) {
      expect(checkCreateLimit("owner", null, 1000).allowed).toBe(true);
    }
  });

  it("refuses the one past the limit and says how long to wait", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("owner", null, 1000);
    const refused = checkCreateLimit("owner", null, 1000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(RATE_WINDOW_MS / 1000);
  });

  it("keeps visitors independent of each other", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("noisy", null, 1000);
    expect(checkCreateLimit("noisy", null, 1000).allowed).toBe(false);
    expect(checkCreateLimit("quiet", null, 1000).allowed).toBe(true);
  });

  it("lets the budget recover as hits age out of the window", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("owner", null, 1000);
    expect(checkCreateLimit("owner", null, 1000).allowed).toBe(false);
    // One millisecond past the window, the first hit no longer counts.
    expect(checkCreateLimit("owner", null, 1000 + RATE_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("slides rather than resetting, so the budget can't be spent twice at a boundary", () => {
    // Spend the whole budget late in a window...
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("owner", null, 1000);
    // ...and a fixed-window limiter would hand out a fresh budget here.
    // A sliding one still refuses, because those hits are still in range.
    expect(checkCreateLimit("owner", null, 1000 + RATE_WINDOW_MS - 1).allowed).toBe(false);
  });

  it("counts down the retry hint as the window advances", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) checkCreateLimit("owner", null, 0);
    const early = checkCreateLimit("owner", null, 0).retryAfterSeconds;
    const later = checkCreateLimit("owner", null, 60_000).retryAfterSeconds;
    expect(later).toBeLessThan(early);
    expect(later).toBeGreaterThan(0);
  });
});

describe("limits that a cookie reset does not clear", () => {
  beforeEach(() => resetRateLimits());

  it("still refuses a client that keeps minting fresh owner ids", () => {
    // Clearing the cookie buys a fresh per-owner allowance, so the owner
    // scope alone cannot bound one client - the address scope does.
    let allowed = 0;
    for (let i = 0; i < MAX_SESSIONS_PER_ADDRESS_PER_WINDOW + 20; i++) {
      if (checkCreateLimit(`fresh-owner-${i}`, "198.51.100.7", 1000).allowed) allowed++;
    }
    expect(allowed).toBe(MAX_SESSIONS_PER_ADDRESS_PER_WINDOW);
    const refused = checkCreateLimit("another-new-owner", "198.51.100.7", 1000);
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe("address");
  });

  it("keeps separate addresses independent", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_ADDRESS_PER_WINDOW; i++) {
      checkCreateLimit(`o${i}`, "198.51.100.7", 1000);
    }
    expect(checkCreateLimit("o", "198.51.100.7", 1000).allowed).toBe(false);
    expect(checkCreateLimit("o", "203.0.113.9", 1000).allowed).toBe(true);
  });

  it("bounds the instance even when traffic is spread across addresses", () => {
    let allowed = 0;
    for (let i = 0; i < MAX_SESSIONS_GLOBAL_PER_WINDOW + 50; i++) {
      if (checkCreateLimit(`o${i}`, `10.0.${Math.floor(i / 200)}.${i % 200}`, 1000).allowed) {
        allowed++;
      }
    }
    expect(allowed).toBe(MAX_SESSIONS_GLOBAL_PER_WINDOW);
    expect(checkCreateLimit("o", "10.9.9.9", 1000).scope).toBe("global");
  });

  it("does not spend one scope's budget on a request another scope refuses", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_ADDRESS_PER_WINDOW; i++) {
      checkCreateLimit(`o${i}`, "198.51.100.7", 1000);
    }
    // This owner is new, and is refused by the address scope; its own budget
    // must be untouched when it comes back from somewhere else.
    expect(checkCreateLimit("late", "198.51.100.7", 1000).allowed).toBe(false);
    for (let i = 0; i < MAX_SESSIONS_PER_WINDOW; i++) {
      expect(checkCreateLimit("late", "203.0.113.9", 1000).allowed).toBe(true);
    }
  });

  it("skips the address scope when there is no forwarded address", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_ADDRESS_PER_WINDOW + 5; i++) {
      checkCreateLimit(`o${i}`, null, 1000);
    }
    expect(checkCreateLimit("another", null, 1000).allowed).toBe(true);
  });
});

describe("bucket eviction", () => {
  beforeEach(() => resetRateLimits());

  it("does not retain a bucket per owner id forever", () => {
    for (let i = 0; i < 200; i++) checkCreateLimit(`visitor-${i}`, null, 1000);
    expect(rateLimitBucketCount()).toBeGreaterThan(200);

    // One call a full window later sweeps everything that has aged out.
    checkCreateLimit("someone", null, 1000 + RATE_WINDOW_MS + 1);
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(2);
  });

  it("does not drop buckets that are still inside the window", () => {
    for (let i = 0; i < 50; i++) checkCreateLimit(`visitor-${i}`, null, 1000);
    const before = rateLimitBucketCount();
    checkCreateLimit("someone", null, 1000 + RATE_WINDOW_MS / 2);
    expect(rateLimitBucketCount()).toBeGreaterThanOrEqual(before);
  });
});

describe("clientAddressFrom", () => {
  it("takes the address the nearest proxy appended, not one the client claims", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" });
    expect(clientAddressFrom(headers)).toBe("198.51.100.7");
  });

  it("handles a single entry", () => {
    expect(clientAddressFrom(new Headers({ "x-forwarded-for": "198.51.100.7" }))).toBe(
      "198.51.100.7"
    );
  });

  it("returns null with no header rather than guessing", () => {
    expect(clientAddressFrom(new Headers())).toBeNull();
    expect(clientAddressFrom(new Headers({ "x-forwarded-for": "  ,  " }))).toBeNull();
  });
});

describe("per-action buckets", () => {
  beforeEach(() => resetRateLimits());

  it("does not let expression evaluation exhaust the session allowance", () => {
    // The playground evaluates freely and needs no session, so its traffic
    // must not be what stops a visitor opening one.
    for (let i = 0; i < MAX_EVALUATIONS_PER_WINDOW; i++) {
      expect(checkEvaluateLimit("owner-1", null).allowed).toBe(true);
    }
    expect(checkEvaluateLimit("owner-1", null).allowed).toBe(false);
    expect(checkCreateLimit("owner-1", null).allowed).toBe(true);
  });

  it("limits evaluation per owner, address and globally", () => {
    for (let i = 0; i < MAX_EVALUATIONS_PER_WINDOW; i++) {
      expect(checkEvaluateLimit("owner-1", "1.2.3.4").allowed).toBe(true);
    }
    const refused = checkEvaluateLimit("owner-1", "1.2.3.4");
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe("owner");
    // A fresh owner id from the same address still has room, but the address
    // scope is what stops that being an unlimited reset.
    expect(checkEvaluateLimit("owner-2", "1.2.3.4").allowed).toBe(true);
  });
});
