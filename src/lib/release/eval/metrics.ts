import { classifyChange } from "../analysis";
import type { EvalCase, EvalSource } from "./types";

export interface CaseResult {
  case: EvalCase;
  actual: ReturnType<typeof classifyChange>;
  /** Every disagreement with the label. All of them are scored. */
  failures: string[];
  /** The subset the case records as accepted. Still counted in every metric; the ratchet pins which cases may carry one. */
  accepted: string[];
}

/** Ratios over an empty denominator are `null` and render as N/A; they are never reported as 100%. */
export type Ratio = number | null;

export interface Metrics {
  total: number;
  falseExclusions: number;
  falseInclusions: number;
  inclusionAccuracy: Ratio;
  categoryCases: number;
  categoryAccuracy: Ratio;
  securityPositives: number;
  securityMisses: number;
  securityRecall: Ratio;
  /** Cases that expect `securitySensitive: false` and were flagged anyway. */
  securityFalseAlarms: number;
  securityNegatives: number;
  breakingPositives: number;
  breakingMisses: number;
  breakingRecall: Ratio;
  breakingFalseAlarms: number;
  breakingNegatives: number;
  /** Cases with at least one failure recorded as accepted (included in the counts above). */
  acceptedCases: number;
  /** Cases with at least one failure that is NOT accepted. */
  unacceptedCases: number;
  openPolicyCases: number;
}

const ratio = (hit: number, total: number): Ratio => total === 0 ? null : hit / total;
/** Failures a case does not record as accepted. */
export const unaccepted = (r: CaseResult) => r.failures.filter(f => !r.accepted.includes(f));

export function evaluateCase(c: EvalCase): CaseResult {
  const sha = "1".repeat(40);
  const actual = classifyChange({ sha, message: c.message, pullTitle: c.pullTitle, reviewFlags: c.reviewFlags, evidence: [{ id: `commit:${sha}`, kind: "commit", label: "1111111", url: "https://github.com/example/project/commit/" + sha }] });
  const all: string[] = [];
  if (actual.releaseWorthy !== c.expected.releaseWorthy) all.push(c.expected.releaseWorthy ? "false exclusion" : "false inclusion");
  if (c.expected.category && actual.category !== c.expected.category) all.push(`category ${actual.category} != ${c.expected.category}`);
  if (c.expected.securitySensitive !== undefined && actual.securitySensitive !== c.expected.securitySensitive) all.push(c.expected.securitySensitive ? "security miss" : "security false alarm");
  if (c.expected.breakingChange !== undefined && actual.breakingChange !== c.expected.breakingChange) all.push(c.expected.breakingChange ? "breaking miss" : "breaking false alarm");
  const tolerated = (failure: string) => c.acceptedMismatch?.kinds.some(kind => failure === kind || (kind === "category" && failure.startsWith("category "))) === true;
  return { case: c, actual, failures: all, accepted: all.filter(tolerated) };
}

export function computeMetrics(results: CaseResult[]): Metrics {
  const count = (rs: CaseResult[], failure: string) => rs.filter(r => r.failures.includes(failure)).length;
  const securityPositive = results.filter(r => r.case.expected.securitySensitive === true);
  const securityNegative = results.filter(r => r.case.expected.securitySensitive === false);
  const breakingPositive = results.filter(r => r.case.expected.breakingChange === true);
  const breakingNegative = results.filter(r => r.case.expected.breakingChange === false);
  const withCategory = results.filter(r => r.case.expected.category);
  const falseExclusions = count(results, "false exclusion");
  const falseInclusions = count(results, "false inclusion");
  const securityMisses = count(securityPositive, "security miss");
  const breakingMisses = count(breakingPositive, "breaking miss");
  return {
    total: results.length, falseExclusions, falseInclusions,
    inclusionAccuracy: ratio(results.length - falseExclusions - falseInclusions, results.length),
    categoryCases: withCategory.length,
    categoryAccuracy: ratio(withCategory.filter(r => !r.failures.some(f => f.startsWith("category "))).length, withCategory.length),
    securityPositives: securityPositive.length, securityMisses, securityRecall: ratio(securityPositive.length - securityMisses, securityPositive.length),
    securityNegatives: securityNegative.length, securityFalseAlarms: count(securityNegative, "security false alarm"),
    breakingPositives: breakingPositive.length, breakingMisses, breakingRecall: ratio(breakingPositive.length - breakingMisses, breakingPositive.length),
    breakingNegatives: breakingNegative.length, breakingFalseAlarms: count(breakingNegative, "breaking false alarm"),
    acceptedCases: results.filter(r => r.accepted.length).length,
    unacceptedCases: results.filter(r => unaccepted(r).length).length,
    openPolicyCases: results.filter(r => r.case.openPolicy).length,
  };
}

export function metricsBySource(results: CaseResult[]): Record<EvalSource, Metrics> {
  return {
    synthetic: computeMetrics(results.filter(r => r.case.source === "synthetic")),
    "maintainer-reviewed": computeMetrics(results.filter(r => r.case.source === "maintainer-reviewed")),
    "ai-draft": computeMetrics(results.filter(r => r.case.source === "ai-draft")),
  };
}

export const percent = (value: Ratio) => value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;

export function formatReport(results: CaseResult[]): string {
  const lines: string[] = ["NOTE: synthetic cases are hand-labeled development data; they are not evidence of real-world accuracy."];
  if (results.some(r => r.case.source === "ai-draft")) lines.push("NOTE: ai-draft scores measure agreement with AI-authored development labels, not human-reviewed accuracy. No human baseline is set from these scores.");
  for (const [source, m] of Object.entries(metricsBySource(results))) {
    lines.push(`[${source}] n=${m.total} inclusion=${percent(m.inclusionAccuracy)} (false incl ${m.falseInclusions}, false excl ${m.falseExclusions}) category=${percent(m.categoryAccuracy)}/${m.categoryCases}`
      + ` security: ${m.securityMisses} misses/${m.securityPositives} positives (recall ${percent(m.securityRecall)}), ${m.securityFalseAlarms} false alarms/${m.securityNegatives} negatives`
      + ` breaking: ${m.breakingMisses} misses/${m.breakingPositives} positives (recall ${percent(m.breakingRecall)}), ${m.breakingFalseAlarms} false alarms/${m.breakingNegatives} negatives`
      + ` | cases with unaccepted failures=${m.unacceptedCases}, with accepted failures=${m.acceptedCases}, open-policy=${m.openPolicyCases}`);
  }
  const show = (r: CaseResult) => JSON.stringify((r.case.pullTitle ? r.case.pullTitle + " | " : "") + r.case.message.split("\n")[0]);
  // Unaccepted and accepted failures are listed separately, even for the same case, so neither hides the other.
  for (const r of results.filter(r => unaccepted(r).length)) lines.push(`  ✗ ${r.case.id}: ${unaccepted(r).join(", ")} — ${show(r)}`);
  for (const r of results.filter(r => r.accepted.length)) lines.push(`  ~ accepted ${r.case.id}: ${r.accepted.join(", ")} — ${show(r)} [${r.case.acceptedMismatch?.reason}]`);
  for (const r of results.filter(r => r.case.openPolicy)) lines.push(`  ? open policy ${r.case.id}: ${r.case.openPolicy}`);
  return lines.join("\n");
}
