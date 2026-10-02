import { describe, expect, it } from "vitest";
import { corpus } from "./corpus";
import { evaluateCase, formatReport, metricsBySource } from "./metrics";

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
];
const BREAKING_POSITIVES = [
  "cc-breaking-bang", "cc-breaking-scope-bang", "cc-breaking-footer", "br-plain-remove", "br-plain-rename", "br-bracket", "br-colon-prefix", "br-incompatible", "br-lowercase-footer",
  "br-plural-footer", "br-bracket-hyphen", "br-bracket-after-type", "br-drop-support", "br-dropped-support", "br-remove-support", "br-no-longer-supports",
  "br-unicode-hyphen", "br-wrapped-lf", "br-wrapped-crlf", "br-footer-lf", "br-footer-crlf", "br-late-bare-cr-footer",
];
/** Protected negatives: each must keep its flag OFF. One broadened pattern cannot hide behind a gain elsewhere. */
const SECURITY_GUARDS = ["sec-guard-expose-ui", "sec-guard-leak-memory", "sec-guard-parser-tokens", "sec-guard-design-tokens", "sec-guard-object-keys", "sec-guard-hardcoded-color", "sec-guard-memory-leak-keys"];
const BREAKING_GUARDS = ["br-not-breaking", "br-guard-bare-breaking", "br-guard-links", "br-guard-not-compatible", "br-guard-avoid", "br-guard-prevent", "br-guard-ensure", "br-guard-doc-bracket", "br-guard-doc-footer", "br-guard-label", "br-guard-remove-plain"];
/** Cases allowed to carry an accepted mismatch. Adding to this list is a deliberate, reviewed edit. */
const ACCEPTED = ["br-incompatible-gap", "sec-bare-token-gap", "sec-guard-sanitize-ui"];
/** Scored security false alarms that are neither guards nor accepted: known, pre-existing. */
const KNOWN_SECURITY_FALSE_ALARMS = ["sec-credential-ui", "sec-false-alarm-docs"];

/**
 * Ratchet over the SYNTHETIC corpus, counting accepted mismatches. These are the measured state of
 * the current deterministic rules, not goals: lower a number when classification improves and never
 * raise one to make a change pass. Print every miss with:
 *   npx vitest run src/lib/release/eval --reporter=verbose --silent=false
 */
const BASELINE = { falseExclusions: 14, falseInclusions: 5, securityMisses: 1, breakingMisses: 1, securityFalseAlarms: 3, breakingFalseAlarms: 0, minCategoryAccuracy: 0.75 };

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
  it("requires provenance on every maintainer-reviewed case and holds them to a stricter bar", () => {
    for (const c of corpus.filter(c => c.source === "maintainer-reviewed")) {
      const p = c.provenance;
      expect(p, `${c.id} needs provenance`).toBeDefined();
      expect(p!.baseSha, c.id).toMatch(/^[0-9a-f]{40}$/); expect(p!.headSha, c.id).toMatch(/^[0-9a-f]{40}$/);
      expect(p!.repository, c.id).toMatch(/^[\w.-]+\/[\w.-]+$/); expect(p!.recordUrl, c.id).toMatch(/^https:\/\//);
      expect(p!.reviewer.length, c.id).toBeGreaterThan(0); expect(p!.reviewedAt, c.id).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(c.acceptedMismatch, `${c.id}: reviewed cases cannot carry accepted mismatches`).toBeUndefined();
    }
    for (const c of corpus.filter(c => c.source === "synthetic")) expect(c.provenance, `${c.id}: synthetic cases must not claim provenance`).toBeUndefined();
    const m = metrics["maintainer-reviewed"];
    if (m.total === 0) return;
    expect(m.securityMisses).toBe(0); expect(m.breakingMisses).toBe(0);
  });
});
