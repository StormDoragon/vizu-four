import { expect, it } from "vitest";
import { reviewedViolations } from "./gate";
import { evaluateCase } from "./metrics";
import type { EvalCase } from "./types";

const fixture: EvalCase = { id: "fixture-only", source: "maintainer-reviewed", message: "feat: add CSV export", expected: { releaseWorthy: false, category: "fixed", securitySensitive: true, breakingChange: true }, provenance: { repository: "example/project", baseSha: "a".repeat(40), headSha: "b".repeat(40), reviewer: "test fixture", reviewedAt: "2026-01-01", recordUrl: "https://example.com/test-fixture" } };
it("ratchets specific disagreements but never security or breaking misses", () => {
  const result = evaluateCase(fixture);
  const baseline = { [fixture.id]: ["false inclusion", "category added != fixed"] };
  expect(reviewedViolations([result], baseline)).toEqual(["fixture-only: security miss", "fixture-only: breaking miss"]);
  expect(reviewedViolations([result], { [fixture.id]: [...baseline[fixture.id], "security miss", "breaking miss"] })).toEqual(expect.arrayContaining(["fixture-only: security miss cannot be baselined", "fixture-only: breaking miss cannot be baselined", "fixture-only: security miss", "fixture-only: breaking miss"]));
});
it("requires resolved disagreements to be removed and rejects baselines for non-human data", () => {
  const fixed = evaluateCase({ ...fixture, expected: { releaseWorthy: true } });
  expect(reviewedViolations([fixed], { [fixture.id]: ["false inclusion"] })).toEqual(["fixture-only: remove resolved baseline disagreement: false inclusion"]);
  expect(reviewedViolations([{ ...fixed, case: { ...fixed.case, source: "ai-draft", provenance: undefined } }], { [fixture.id]: ["false inclusion"] })).toEqual(["fixture-only: baseline case is not present as maintainer-reviewed"]);
});
it("fails a new disagreement even when another case already has the same kind", () => {
  const one = evaluateCase({ ...fixture, expected: { releaseWorthy: false } });
  const two = evaluateCase({ ...fixture, id: "new-case", expected: { releaseWorthy: false } });
  expect(reviewedViolations([one, two], { [fixture.id]: ["false inclusion"] })).toEqual(["new-case: false inclusion"]);
});
