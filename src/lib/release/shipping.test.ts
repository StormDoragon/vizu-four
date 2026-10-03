import { describe, expect, it } from "vitest";
import { analyzeRelease, classifyChange, renderNotes } from "./analysis";
import { reviewFlags } from "./flags";
import { releaseFixture } from "./fixtures";

describe("release review signals", () => {
  it.each([
    "Mask overlapping secrets in captured stderr",
    "Reject path confinement escapes when writing artifacts",
    "Bound request bodies before allocating buffers",
    "Bound provider concurrency and spending",
    "Fix work that held the whole server for a visitor",
    "Prevent a whole instance down condition",
    "Neutralize URLs in exported untrusted descriptions",
  ])("withholds a protective change from notes: %s", message => {
    const analysis = analyzeRelease(releaseFixture([message]));
    expect(analysis.changes[0].securitySensitive).toBe(true);
    for (const notes of Object.values(renderNotes(analysis))) expect(notes).not.toContain(message);
  });
  it.each(["Bound the chart axes", "Mask a profile photo", "Fix a memory leak in the editor", "Skip unreadable dangling symlinks while listing workflows", "Collapse duplicate rows in the table"])("does not escalate ordinary changes: %s", message => {
    expect(reviewFlags(message).securitySensitive).toBe(false);
  });
  it.each(["Refuse duplicate form submissions", "Compute the corrected preview", "Keep the dialog open after validation", "Don't crash on an empty list", "✨ Fixed report sorting", "PROJ-321: Implement CSV import"])("recognizes ordinary change wording: %s", message => {
    expect(classifyChange(releaseFixture([message]).commits[0]).releaseWorthy).toBe(true);
  });
  it("separates explicit new incompatibility from a repair or prevention", () => {
    expect(reviewFlags("Now incompatible with Node 16").breakingChange).toBe(true);
    expect(reviewFlags("Fix plugin incompatible with Node 20").breakingChange).toBe(false);
    expect(reviewFlags("Prevent becoming incompatible with Node 20").breakingChange).toBe(false);
    expect(reviewFlags("Bound accumulated configuration to 1000 keys").breakingChange).toBe(true);
  });
  it("retains security review flags when a test or merge is excluded", () => {
    for (const message of ["test: secret leak regression", "Merge pull request #7\n\nFix server DoS"]) {
      expect(classifyChange(releaseFixture([message]).commits[0])).toMatchObject({ releaseWorthy: false, securitySensitive: true });
    }
  });
  it.each(["✨ docs: status update", "PROJ-123: docs: record release review", "✨ Merge branch feature", "PROJ-123: Tidy up old imports"])("excludes prefixed administrative metadata: %s", message => {
    expect(classifyChange(releaseFixture([message]).commits[0]).releaseWorthy).toBe(false);
  });
  it("uses a meaningful body signal in technical notes while preserving the source title", () => {
    const analysis = analyzeRelease(releaseFixture(["Cleanup\n\nfix: users could not reset passwords"]));
    expect(analysis.changes[0]).toMatchObject({ title: "Cleanup", technical: "fix: users could not reset passwords", releaseWorthy: true });
    expect(renderNotes(analysis).technical).toContain("users could not reset passwords");
  });
  it("bounds the new review scans on long hostile metadata", () => {
    const text = "mask " + "x".repeat(500_000) + "\n" + "Bound ".repeat(50_000);
    const start = performance.now();
    expect(reviewFlags(text)).toEqual({ securitySensitive: false, breakingChange: false });
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
