import { describe, expect, it } from "vitest";
import { statusStyle, type StatusKind } from "./statusStyles";

const ALL_STATUSES: StatusKind[] = [
  "pending",
  "ready",
  "blocked",
  "running",
  "paused",
  "success",
  "failure",
  "skipped",
  "cancelled",
];

describe("statusStyle", () => {
  it("defines every status a lane or step can actually report", () => {
    for (const status of ALL_STATUSES) {
      const style = statusStyle(status);
      expect(style.dotClass).toContain("bg-status-");
      expect(style.textClass).toContain("text-status-");
      expect(style.badgeClass).toContain("bg-status-");
      expect(style.badgeClass).toContain("text-status-");
      expect(style.glyph.length).toBeGreaterThan(0);
      expect(style.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every visually-distinct status a non-color glyph, so status is never color-only (WCAG 1.4.1)", () => {
    // "ready" intentionally shares pending's glyph - to a viewer they're
    // the same "hasn't started" concept, just different scopes (a step vs.
    // a whole lane).
    const distinct = ALL_STATUSES.filter((s) => s !== "ready");
    const glyphs = distinct.map((s) => statusStyle(s).glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("falls back to pending for an unknown or missing status instead of rendering unstyled", () => {
    expect(statusStyle(undefined)).toEqual(statusStyle("pending"));
    expect(statusStyle("some-future-status")).toEqual(statusStyle("pending"));
  });

  it("renders not-yet-run states (pending/ready/blocked) as a hollow ring, not a filled dot", () => {
    expect(statusStyle("pending").hollow).toBe(true);
    expect(statusStyle("ready").hollow).toBe(true);
    expect(statusStyle("blocked").hollow).toBe(true);
  });

  it("renders every state that has actually happened as a filled dot", () => {
    for (const status of ["running", "paused", "success", "failure", "skipped", "cancelled"] as const) {
      expect(statusStyle(status).hollow).toBe(false);
    }
  });

  it("groups cancelled with skipped visually (both 'didn't run, not a failure') but keeps a distinct glyph", () => {
    const skipped = statusStyle("skipped");
    const cancelled = statusStyle("cancelled");
    expect(cancelled.dotClass).toBe(skipped.dotClass);
    expect(cancelled.textClass).toBe(skipped.textClass);
    expect(cancelled.glyph).not.toBe(skipped.glyph);
    expect(cancelled.label).not.toBe(skipped.label);
  });

  it("gives success and failure different colors and different glyphs (never distinguishable by hue alone)", () => {
    const success = statusStyle("success");
    const failure = statusStyle("failure");
    expect(success.dotClass).not.toBe(failure.dotClass);
    expect(success.glyph).not.toBe(failure.glyph);
  });
});
