import { describe, expect, it } from "vitest";
import { isOwner } from "./ownership";
import type { DebugSession } from "./types";

function session(ownerId: string): DebugSession {
  return { ownerId } as unknown as DebugSession;
}

describe("isOwner", () => {
  it("accepts the visitor the session was created for", () => {
    expect(isOwner(session("owner-a"), "owner-a")).toBe(true);
  });

  it("rejects a different visitor", () => {
    expect(isOwner(session("owner-a"), "owner-b")).toBe(false);
  });

  it("rejects a visitor with no owner cookie at all", () => {
    expect(isOwner(session("owner-a"), null)).toBe(false);
    expect(isOwner(session("owner-a"), undefined)).toBe(false);
  });

  it("never treats an empty cookie as a match, even against an empty ownerId", () => {
    // A blank cookie value must not authenticate anything: if a session ever
    // ended up with an empty ownerId, a plain equality check would hand it
    // to every visitor who has no cookie.
    expect(isOwner(session(""), "")).toBe(false);
    expect(isOwner(session("owner-a"), "")).toBe(false);
  });

  it("is an exact match, not a prefix or case-insensitive one", () => {
    expect(isOwner(session("owner-a"), "owner-a-extra")).toBe(false);
    expect(isOwner(session("owner-a"), "owner")).toBe(false);
    expect(isOwner(session("owner-a"), "OWNER-A")).toBe(false);
  });
});
