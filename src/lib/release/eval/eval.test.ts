import { describe, expect, it } from "vitest";
import { corpus } from "./corpus";
import { evaluateCase, formatReport, metricsBySource } from "./metrics";

const results = corpus.map(evaluateCase);
const metrics = metricsBySource(results);

/**
 * Ratchet over the SYNTHETIC corpus. These are the measured baseline of the current deterministic
 * rules, not goals: lower the numbers when classification improves, and never raise them to make
 * a change pass. Run `npx vitest run src/lib/release/eval --reporter=verbose --silent=false`
 * to print every miss.
 */
const BASELINE = { falseExclusions: 17, falseInclusions: 5, securityMisses: 3, breakingMisses: 2, minCategoryAccuracy: 0.66 };

describe("release classification evaluation", () => {
  it("has unique case ids and only declared sources", () => {
    expect(new Set(corpus.map(c => c.id)).size).toBe(corpus.length);
    expect(corpus.every(c => c.source === "synthetic" || c.source === "maintainer-reviewed")).toBe(true);
  });
  it("prints the report", () => { console.log(`\n${formatReport(results)}\n`); });
  it("does not regress past the recorded baseline", () => {
    const m = metrics.synthetic;
    expect(m.falseExclusions).toBeLessThanOrEqual(BASELINE.falseExclusions);
    expect(m.falseInclusions).toBeLessThanOrEqual(BASELINE.falseInclusions);
    expect(m.securityMisses).toBeLessThanOrEqual(BASELINE.securityMisses);
    expect(m.breakingMisses).toBeLessThanOrEqual(BASELINE.breakingMisses);
    expect(m.categoryAccuracy).toBeGreaterThanOrEqual(BASELINE.minCategoryAccuracy);
  });
  it("holds maintainer-reviewed cases to a stricter bar once they exist", () => {
    const m = metrics["maintainer-reviewed"];
    if (m.total === 0) return;
    expect(m.securityMisses).toBe(0);
    expect(m.breakingMisses).toBe(0);
  });
});
