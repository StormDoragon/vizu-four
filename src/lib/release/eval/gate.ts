import type { CaseResult } from "./metrics";
import type { EvalCase } from "./types";

/**
 * Shape check for a maintainer-reviewed case's provenance. This verifies that the fields are present
 * and well-formed; it CANNOT verify that a human really reviewed anything. A well-formed record is a
 * pointer a person can follow, not independent confirmation, and must never be cited as one.
 */
export function provenanceProblems(c: EvalCase): string[] {
  const p = c.provenance;
  if (!p) return ["missing provenance"];
  const problems: string[] = [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(p.repository)) problems.push("repository must be owner/name");
  if (!/^[0-9a-f]{40}$/.test(p.baseSha) || !/^[0-9a-f]{40}$/.test(p.headSha)) problems.push("base/head must be 40-character commit SHAs");
  if (!p.reviewer.trim()) problems.push("reviewer is empty");
  if (!/^\d{4}-\d{2}-\d{2}/.test(p.reviewedAt)) problems.push("reviewedAt must start with YYYY-MM-DD");
  if (!/^https:\/\//.test(p.recordUrl)) problems.push("recordUrl must be an https link");
  return problems;
}

/**
 * With no baseline, reviewed cases must match every label. An explicitly supplied
 * human-reviewed baseline may pin exact inclusion/category/false-alarm disagreements
 * by case ID. New disagreements fail; resolved ones must be removed. Security and
 * breaking misses can never be baselined. No human baseline is populated yet.
 */
export type ReviewedBaseline = Record<string, string[]>;

export function reviewedViolations(results: CaseResult[], baseline: ReviewedBaseline = {}): string[] {
  const violations: string[] = [];
  const reviewed = new Map(results.filter(r => r.case.source === "maintainer-reviewed").map(r => [r.case.id, r]));
  const allowedFailure = (failure: string) => ["false inclusion", "false exclusion", "security false alarm", "breaking false alarm"].includes(failure) || /^category \w+ != \w+$/.test(failure);
  for (const [id, failures] of Object.entries(baseline)) {
    const result = reviewed.get(id);
    if (!result) { violations.push(`${id}: baseline case is not present as maintainer-reviewed`); continue; }
    if (!failures.length || new Set(failures).size !== failures.length) violations.push(`${id}: baseline must contain unique disagreements`);
    for (const failure of failures) {
      if (!allowedFailure(failure)) violations.push(`${id}: ${failure} cannot be baselined`);
      else if (!result.failures.includes(failure)) violations.push(`${id}: remove resolved baseline disagreement: ${failure}`);
    }
  }
  for (const r of results) {
    const c = r.case;
    if (c.source === "ai-draft") {
      if (c.provenance) violations.push(`${c.id}: AI drafts must not claim human review provenance`);
      continue;
    }
    if (c.source === "synthetic") {
      if (c.provenance) violations.push(`${c.id}: synthetic cases must not claim provenance`);
      continue;
    }
    for (const problem of provenanceProblems(c)) violations.push(`${c.id}: ${problem}`);
    if (c.acceptedMismatch) violations.push(`${c.id}: reviewed cases cannot carry accepted mismatches`);
    for (const failure of r.failures) {
      if (!allowedFailure(failure) || !baseline[c.id]?.includes(failure)) violations.push(`${c.id}: ${failure}`);
    }
  }
  return violations;
}
