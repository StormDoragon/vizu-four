import { describe, expect, it } from "vitest";
import { corpus } from "./corpus";
import { evaluateCase, formatReport, metricsBySource } from "./metrics";
import { provenanceProblems, reviewedViolations } from "./gate";
import type { EvalCase } from "./types";

const results = corpus.map(evaluateCase);
const byId = new Map(results.map(r => [r.case.id, r]));
const metrics = metricsBySource(results);
const result = (id: string) => { const r = byId.get(id); if (!r) throw new Error(`Required eval case missing: ${id}`); return r; };

/**
 * Cases that MUST stay in the corpus. Aggregate counts alone cannot see a deleted case, or a
 * deleted guard offset by an improvement elsewhere, so each required case is asserted by id.
 */
const SECURITY_POSITIVES = [
  "sec-cve", "sec-xss", "sec-csrf", "sec-traversal", "sec-bypass", "sec-injection", "sec-ssrf", "sec-sanitize", "sec-leak", "sec-body-only",
  "sec-xxe", "sec-open-redirect", "sec-priv-esc", "sec-token-exposed", "sec-password-leak",
  "sec-timing", "sec-overflow", "sec-zipslip", "sec-proto", "sec-deser-unsafe", "sec-deser-insecure", "sec-fullwidth",
  "sec-secrets-noun", "sec-password-noun", "sec-apikey-leak", "sec-session-token-noun", "sec-bearer-logged", "sec-keys-dumped", "sec-key-printed",
  "sec-hardcoded-secret", "sec-hardcoded-hyphen", "sec-wrapped-lf", "sec-wrapped-crlf", "sec-nb-space", "sec-late-footer",
  "sec-r9-hyphen", "sec-r9-nb-hyphen", "sec-r9-nospace", "sec-r9-logs", "sec-r9-log", "sec-r9-logged", "sec-r9-logging",
];
const BREAKING_POSITIVES = [
  "cc-breaking-bang", "cc-breaking-scope-bang", "cc-breaking-footer", "br-plain-remove", "br-plain-rename", "br-bracket", "br-colon-prefix", "br-incompatible", "br-lowercase-footer",
  "br-plural-footer", "br-bracket-hyphen", "br-bracket-after-type", "br-drop-support", "br-dropped-support", "br-remove-support", "br-no-longer-supports",
  "br-unicode-hyphen", "br-wrapped-lf", "br-wrapped-crlf", "br-footer-lf", "br-footer-crlf", "br-late-bare-cr-footer",
  "br-r10-ship", "br-r10-making", "br-r10-fixes-colon",
  "br-scope-semicolon-prevent", "br-scope-semicolon-preserve", "br-scope-newline-declaration", "br-scope-semicolon-incompat", "br-scope-wrapped-phrase",
  "br-wrap-trailing-space", "br-wrap-leading-space", "br-wrap-both-spaces", "br-wrap-both-spaces-crlf", "br-wrap-both-spaces-cr",
];
/** Protected negatives: each must keep its flag OFF. One broadened pattern cannot hide behind a gain elsewhere. */
const SECURITY_GUARDS = ["sec-guard-expose-ui", "sec-guard-leak-memory", "sec-guard-parser-tokens", "sec-guard-design-tokens", "sec-guard-object-keys", "sec-guard-hardcoded-color", "sec-guard-memory-leak-keys",
  "sec-guard-parser-leak", "sec-guard-object-keys-exposed", "sec-guard-paragraph-lf", "sec-guard-paragraph-spaces", "sec-guard-paragraph-tab-crlf"];
const BREAKING_GUARDS = ["br-not-breaking", "br-guard-bare-breaking", "br-guard-links", "br-guard-not-compatible", "br-guard-avoid", "br-guard-prevent", "br-guard-ensure", "br-guard-doc-bracket", "br-guard-doc-footer", "br-guard-label", "br-guard-remove-plain",
  "br-guard-fix-avoid", "br-guard-avoid-drop", "br-guard-dont-remove",
  "br-scope-guard-do-not", "br-scope-guard-end-of-support", "br-scope-guard-wrapped-negator", "br-scope-guard-wrapped-prevent", "br-scope-guard-prevent-only",
  "br-wrap-guard-blank", "br-wrap-guard-spaces-blank"];
/** Cases allowed to carry an accepted mismatch. Adding to this list is a deliberate, reviewed edit. */
/** The three "gap" cases and both "open" cases are PENDING maintainer decisions, not completed fixes. */
const ACCEPTED = ["br-incompatible-gap", "sec-bare-token-gap", "sec-guard-sanitize-ui", "sec-open-keys-logs", "sec-open-token-logs"];
/** Scored security false alarms that are neither guards nor accepted: known, pre-existing. */
const KNOWN_SECURITY_FALSE_ALARMS = ["sec-credential-ui", "sec-false-alarm-docs"];

/**
 * Ratchet over the SYNTHETIC corpus, counting accepted mismatches. These are the measured state of
 * the current deterministic rules, not goals: lower a number when classification improves and never
 * raise one to make a change pass. Print every miss with:
 *   npx vitest run src/lib/release/eval --reporter=verbose --silent=false
 */
const BASELINE = { falseExclusions: 14, falseInclusions: 5, securityMisses: 3, breakingMisses: 1, securityFalseAlarms: 3, breakingFalseAlarms: 0, minCategoryAccuracy: 0.77 };

describe("release classification evaluation", () => {
  it("has a nonempty corpus with unique ids and only declared sources", () => {
    expect(corpus.length).toBeGreaterThan(0);
    expect(new Set(corpus.map(c => c.id)).size).toBe(corpus.length);
    expect(corpus.every(c => c.source === "synthetic" || c.source === "maintainer-reviewed")).toBe(true);
    expect(metrics.synthetic.total).toBeGreaterThan(0);
  });
  it("prints the report", () => { console.log(`\n${formatReport(results)}\n`); });

  it("retains every required security-positive and breaking-positive case with its expectation", () => {
    for (const id of SECURITY_POSITIVES) expect(result(id).case.expected.securitySensitive, id).toBe(true);
    for (const id of BREAKING_POSITIVES) expect(result(id).case.expected.breakingChange, id).toBe(true);
  });
  it("catches every required positive, per case", () => {
    for (const id of SECURITY_POSITIVES) expect(result(id).actual.securitySensitive, `${id} must be flagged security`).toBe(true);
    for (const id of BREAKING_POSITIVES) expect(result(id).actual.breakingChange, `${id} must be flagged breaking`).toBe(true);
  });
  it("keeps every protected negative flag off, per case", () => {
    for (const id of SECURITY_GUARDS) { expect(result(id).case.expected.securitySensitive, id).toBe(false); expect(result(id).actual.securitySensitive, `${id} must NOT be flagged security`).toBe(false); }
    for (const id of BREAKING_GUARDS) { expect(result(id).case.expected.breakingChange, id).toBe(false); expect(result(id).actual.breakingChange, `${id} must NOT be flagged breaking`).toBe(false); }
  });
  it("pins which cases may carry an accepted mismatch, and requires a reason", () => {
    expect(corpus.filter(c => c.acceptedMismatch).map(c => c.id).sort()).toEqual([...ACCEPTED].sort());
    for (const c of corpus.filter(c => c.acceptedMismatch)) expect(c.acceptedMismatch!.reason.length, c.id).toBeGreaterThan(20);
    // An accepted mismatch that no longer happens is stale: remove it so the pin stays truthful.
    for (const id of ACCEPTED) expect(result(id).accepted.length, `${id} is listed as accepted but no longer mismatches`).toBeGreaterThan(0);
  });
  it("pins the two known security false alarms outside the guards", () => {
    const alarms = results.filter(r => r.failures.includes("security false alarm") && !r.accepted.includes("security false alarm")).map(r => r.case.id);
    expect(alarms.sort()).toEqual([...KNOWN_SECURITY_FALSE_ALARMS].sort());
  });
  it("does not regress past the recorded baseline", () => {
    const m = metrics.synthetic;
    expect(m.falseExclusions).toBeLessThanOrEqual(BASELINE.falseExclusions);
    expect(m.falseInclusions).toBeLessThanOrEqual(BASELINE.falseInclusions);
    expect(m.securityMisses).toBeLessThanOrEqual(BASELINE.securityMisses);
    expect(m.breakingMisses).toBeLessThanOrEqual(BASELINE.breakingMisses);
    expect(m.securityFalseAlarms).toBeLessThanOrEqual(BASELINE.securityFalseAlarms);
    expect(m.breakingFalseAlarms).toBeLessThanOrEqual(BASELINE.breakingFalseAlarms);
    expect(m.categoryAccuracy).toBeGreaterThanOrEqual(BASELINE.minCategoryAccuracy);
  });
  it("holds every maintainer-reviewed case to its stated labels and provenance", () => {
    expect(reviewedViolations(results)).toEqual([]);
  });
});

/**
 * The gate is exercised with a TEST FIXTURE only. It is not corpus data and its provenance is invented,
 * which is exactly why a well-formed record must never be read as proof that a human reviewed anything.
 */
const fixture = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  id: "fixture", source: "maintainer-reviewed", message: "feat: add CSV export", expected: { releaseWorthy: true, category: "added" },
  provenance: { repository: "example/project", baseSha: "a".repeat(40), headSha: "b".repeat(40), reviewer: "test fixture", reviewedAt: "2026-01-01", recordUrl: "https://example.com/review/1" },
  ...overrides,
});

describe("reviewed-case gate", () => {
  it("passes a reviewed case that matches every label", () => {
    expect(reviewedViolations([evaluateCase(fixture())])).toEqual([]);
  });
  it("fails a reviewed case on a false exclusion", () => {
    const excluded = fixture({ id: "false-exclusion", message: "chore: refresh tooling", expected: { releaseWorthy: true } });
    expect(reviewedViolations([evaluateCase(excluded)])).toEqual(["false-exclusion: false exclusion"]);
  });
  it("fails a reviewed case on a wrong category, a security miss, and a breaking miss", () => {
    const wrong = fixture({ id: "wrong", message: "feat: add CSV export", expected: { releaseWorthy: true, category: "fixed", securitySensitive: true, breakingChange: true } });
    expect(reviewedViolations([evaluateCase(wrong)]).sort()).toEqual(["wrong: breaking miss", "wrong: category added != fixed", "wrong: security miss"]);
  });
  it("rejects a reviewed case that tries to carry an accepted mismatch", () => {
    const tolerated = fixture({ id: "tolerated", message: "chore: refresh tooling", expected: { releaseWorthy: true }, acceptedMismatch: { kinds: ["false exclusion"], reason: "Pretending a miss is fine." } });
    expect(reviewedViolations([evaluateCase(tolerated)])).toEqual(expect.arrayContaining(["tolerated: reviewed cases cannot carry accepted mismatches", "tolerated: false exclusion"]));
  });
  it("requires well-formed provenance and rejects synthetic cases that claim it", () => {
    expect(reviewedViolations([evaluateCase(fixture({ id: "none", provenance: undefined }))])).toEqual(["none: missing provenance"]);
    const bad = fixture({ id: "bad", provenance: { repository: "not a repo", baseSha: "main", headSha: "b".repeat(40), reviewer: " ", reviewedAt: "yesterday", recordUrl: "http://x" } });
    expect(provenanceProblems(bad)).toHaveLength(5);
    expect(reviewedViolations([evaluateCase(fixture({ id: "syn", source: "synthetic" }))])).toEqual(["syn: synthetic cases must not claim provenance"]);
  });
  it("does not run a reviewed fixture through the synthetic baseline", () => {
    const by = metricsBySource([evaluateCase(fixture())]);
    expect(by.synthetic.total).toBe(0); expect(by["maintainer-reviewed"].total).toBe(1);
  });
});
