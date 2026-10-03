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
 * Reviewed cases are held to their stated labels exactly: inclusion, category, security and breaking.
 * No accepted mismatch is allowed, because a reviewed label is the maintainer's decision, not a guess
 * the implementer may tolerate. Synthetic cases may not claim provenance.
 */
export function reviewedViolations(results: CaseResult[]): string[] {
  const violations: string[] = [];
  for (const r of results) {
    const c = r.case;
    if (c.source === "synthetic") {
      if (c.provenance) violations.push(`${c.id}: synthetic cases must not claim provenance`);
      continue;
    }
    for (const problem of provenanceProblems(c)) violations.push(`${c.id}: ${problem}`);
    if (c.acceptedMismatch) violations.push(`${c.id}: reviewed cases cannot carry accepted mismatches`);
    for (const failure of r.failures) violations.push(`${c.id}: ${failure}`);
  }
  return violations;
}
