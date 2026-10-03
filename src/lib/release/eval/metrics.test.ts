import { describe, expect, it } from "vitest";
import { computeMetrics, evaluateCase, formatReport, metricsBySource, percent } from "./metrics";
import type { EvalCase } from "./types";

const make = (id: string, message: string, expected: EvalCase["expected"], extra: Partial<EvalCase> = {}): EvalCase => ({ id, source: "synthetic", message, expected, ...extra });

describe("eval metrics", () => {
  it("reports every ratio as N/A, not 100%, for empty results", () => {
    const m = computeMetrics([]);
    expect(m).toMatchObject({ total: 0, inclusionAccuracy: null, categoryAccuracy: null, securityRecall: null, breakingRecall: null, securityPositives: 0, breakingPositives: 0 });
    expect(percent(m.securityRecall)).toBe("N/A");
    expect(formatReport([])).toContain("recall N/A");
    expect(formatReport([])).not.toMatch(/recall 100/);
  });
  it("reports recall as N/A when there are no positives, even with other cases", () => {
    const m = computeMetrics([evaluateCase(make("a", "feat: add export", { releaseWorthy: true, category: "added" }))]);
    expect(m.securityPositives).toBe(0); expect(m.securityRecall).toBeNull();
    expect(m.breakingPositives).toBe(0); expect(m.breakingRecall).toBeNull();
    expect(m.inclusionAccuracy).toBe(1);
  });
  it("counts positives, misses, negatives, and false alarms separately for mixed labels", () => {
    const m = computeMetrics([
      evaluateCase(make("hit", "Fix XSS in comments", { releaseWorthy: true, securitySensitive: true })),
      evaluateCase(make("miss", "Add a thing", { releaseWorthy: true, securitySensitive: true })),
      evaluateCase(make("alarm", "docs: link the security policy", { releaseWorthy: true, securitySensitive: false })),
      evaluateCase(make("quiet", "feat: add export", { releaseWorthy: true, securitySensitive: false })),
      evaluateCase(make("break-hit", "feat!: drop api", { releaseWorthy: true, breakingChange: true })),
      evaluateCase(make("break-alarm", "feat!: drop api", { releaseWorthy: true, breakingChange: false })),
    ]);
    expect(m).toMatchObject({ securityPositives: 2, securityMisses: 1, securityRecall: 0.5, securityNegatives: 2, securityFalseAlarms: 1, breakingPositives: 1, breakingMisses: 0, breakingRecall: 1, breakingNegatives: 1, breakingFalseAlarms: 1 });
  });
  it("scores inclusion only when a category is omitted, and category only when given", () => {
    const m = computeMetrics([
      evaluateCase(make("no-category", "An unspecified thing", { releaseWorthy: false })),
      evaluateCase(make("wrong-category", "fix: a thing", { releaseWorthy: true, category: "added" })),
      evaluateCase(make("right-category", "fix: a thing", { releaseWorthy: true, category: "fixed" })),
    ]);
    expect(m.categoryCases).toBe(2); expect(m.categoryAccuracy).toBe(0.5);
    expect(m.total).toBe(3);
    const ids = computeMetrics([evaluateCase(make("only-inclusion", "An unspecified thing", { releaseWorthy: true }))]);
    expect(ids.categoryCases).toBe(0); expect(ids.categoryAccuracy).toBeNull(); expect(ids.falseExclusions).toBe(1);
  });
  it("keeps accepted mismatches in the counts and flags them as accepted", () => {
    const accepted = evaluateCase(make("a", "Add sanitize button", { releaseWorthy: true, securitySensitive: false }, { acceptedMismatch: { kinds: ["security false alarm"], reason: "Conservative flagging is intentional here." } }));
    expect(accepted.failures).toContain("security false alarm"); expect(accepted.accepted).toEqual(["security false alarm"]);
    const m = computeMetrics([accepted]);
    expect(m.securityFalseAlarms).toBe(1); expect(m.acceptedCases).toBe(1);
    expect(formatReport([accepted])).toContain("~ accepted a");
  });
  it("lists accepted and unaccepted failures on separate lines, even for the same case", () => {
    const both = evaluateCase(make("both", "Add sanitize button", { releaseWorthy: false, securitySensitive: false }, { acceptedMismatch: { kinds: ["security false alarm"], reason: "Conservative flagging is intentional here." } }));
    const lines = formatReport([both]).split("\n");
    expect(lines).toContain('  ✗ both: false inclusion — "Add sanitize button"');
    expect(lines.some(l => l.startsWith("  ~ accepted both: security false alarm"))).toBe(true);
    expect(lines.some(l => l.startsWith("  ✗ both:") && l.includes("security false alarm"))).toBe(false);
    expect(lines.some(l => l.startsWith("  ~ accepted both:") && l.includes("false inclusion"))).toBe(false);
    expect(computeMetrics([both])).toMatchObject({ unacceptedCases: 1, acceptedCases: 1 });
  });
  it("does not let an accepted kind excuse a different failure", () => {
    const r = evaluateCase(make("a", "Add sanitize button", { releaseWorthy: false, securitySensitive: false }, { acceptedMismatch: { kinds: ["security false alarm"], reason: "Conservative flagging is intentional here." } }));
    expect(r.failures).toEqual(expect.arrayContaining(["security false alarm", "false inclusion"]));
    expect(r.accepted).toEqual(["security false alarm"]);
  });
  it("separates sources", () => {
    const reviewed = make("r", "Fix XSS", { releaseWorthy: true, securitySensitive: true }, { source: "maintainer-reviewed" });
    const synthetic = make("s", "Add a thing", { releaseWorthy: true, securitySensitive: true });
    const by = metricsBySource([evaluateCase(reviewed), evaluateCase(synthetic)]);
    expect(by["maintainer-reviewed"]).toMatchObject({ total: 1, securityPositives: 1, securityMisses: 0, securityRecall: 1 });
    expect(by.synthetic).toMatchObject({ total: 1, securityPositives: 1, securityMisses: 1, securityRecall: 0 });
  });
  it("always carries the synthetic-data warning", () => {
    expect(formatReport([])).toContain("not evidence of real-world accuracy");
  });
});
