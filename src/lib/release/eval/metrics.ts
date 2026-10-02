import { classifyChange } from "../analysis";
import type { EvalCase, EvalSource } from "./types";

export interface CaseResult { case: EvalCase; actual: ReturnType<typeof classifyChange>; failures: string[] }
export interface Metrics {
  total: number;
  /** Excluded by the classifier although a maintainer would ship it. */
  falseExclusions: number;
  /** Included by the classifier although it should not appear in notes. */
  falseInclusions: number;
  inclusionAccuracy: number;
  /** Over cases that specify a category. */
  categoryAccuracy: number;
  categoryCases: number;
  /** Recall matters most for these two: a miss ships a risky change unflagged. */
  securityRecall: number;
  breakingRecall: number;
  securityMisses: number;
  breakingMisses: number;
}

const ratio = (hit: number, total: number) => total === 0 ? 1 : hit / total;

export function evaluateCase(c: EvalCase): CaseResult {
  const sha = "1".repeat(40);
  const actual = classifyChange({ sha, message: c.message, pullTitle: c.pullTitle, evidence: [{ id: `commit:${sha}`, kind: "commit", label: "1111111", url: "https://github.com/example/project/commit/" + sha }] });
  const failures: string[] = [];
  if (actual.releaseWorthy !== c.expected.releaseWorthy) failures.push(c.expected.releaseWorthy ? "false exclusion" : "false inclusion");
  if (c.expected.category && actual.category !== c.expected.category) failures.push(`category ${actual.category} != ${c.expected.category}`);
  if (c.expected.securitySensitive !== undefined && actual.securitySensitive !== c.expected.securitySensitive) failures.push(c.expected.securitySensitive ? "security miss" : "security false alarm");
  if (c.expected.breakingChange !== undefined && actual.breakingChange !== c.expected.breakingChange) failures.push(c.expected.breakingChange ? "breaking miss" : "breaking false alarm");
  return { case: c, actual, failures };
}

export function computeMetrics(results: CaseResult[]): Metrics {
  const has = (r: CaseResult, f: string) => r.failures.includes(f);
  const security = results.filter(r => r.case.expected.securitySensitive);
  const breaking = results.filter(r => r.case.expected.breakingChange);
  const withCategory = results.filter(r => r.case.expected.category);
  const falseExclusions = results.filter(r => has(r, "false exclusion")).length;
  const falseInclusions = results.filter(r => has(r, "false inclusion")).length;
  const securityMisses = security.filter(r => has(r, "security miss")).length;
  const breakingMisses = breaking.filter(r => has(r, "breaking miss")).length;
  return {
    total: results.length, falseExclusions, falseInclusions,
    inclusionAccuracy: ratio(results.length - falseExclusions - falseInclusions, results.length),
    categoryCases: withCategory.length,
    categoryAccuracy: ratio(withCategory.filter(r => !r.failures.some(f => f.startsWith("category"))).length, withCategory.length),
    securityRecall: ratio(security.length - securityMisses, security.length), securityMisses,
    breakingRecall: ratio(breaking.length - breakingMisses, breaking.length), breakingMisses,
  };
}

export function metricsBySource(results: CaseResult[]): Record<EvalSource, Metrics> {
  return {
    synthetic: computeMetrics(results.filter(r => r.case.source === "synthetic")),
    "maintainer-reviewed": computeMetrics(results.filter(r => r.case.source === "maintainer-reviewed")),
  };
}

export function formatReport(results: CaseResult[]): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [];
  for (const [source, m] of Object.entries(metricsBySource(results))) {
    lines.push(`[${source}] n=${m.total} inclusion=${pct(m.inclusionAccuracy)} (false incl ${m.falseInclusions}, false excl ${m.falseExclusions}) category=${pct(m.categoryAccuracy)}/${m.categoryCases} security-recall=${pct(m.securityRecall)} breaking-recall=${pct(m.breakingRecall)}`);
  }
  for (const r of results.filter(r => r.failures.length)) lines.push(`  ✗ ${r.case.id}: ${r.failures.join(", ")} — ${JSON.stringify((r.case.pullTitle ? r.case.pullTitle + " | " : "") + r.case.message.split("\n")[0])}`);
  return lines.join("\n");
}
