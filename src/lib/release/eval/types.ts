import type { ReleaseChange } from "../types";

/**
 * "synthetic" cases are hand-written by the implementer to probe known-hard metadata shapes.
 * Only "maintainer-reviewed" cases may be cited as evidence of real-world accuracy, and each one
 * must carry provenance (see `Provenance`). Metrics are always reported per source.
 */
export type EvalSource = "synthetic" | "maintainer-reviewed";

export interface EvalExpectation {
  releaseWorthy: boolean;
  /** Omit when any category is acceptable as long as inclusion is right. */
  category?: ReleaseChange["category"];
  securitySensitive?: boolean;
  breakingChange?: boolean;
}

/** What a reviewed case must be able to point back to. A label without these is not a review. */
export interface Provenance {
  repository: string;
  /** Immutable commit SHAs, never branch or tag names. */
  baseSha: string;
  headSha: string;
  /** Who confirmed the labels, and a link to the record of that review (issue, PR comment, document). */
  reviewer: string;
  reviewedAt: string;
  recordUrl: string;
}

/** A scored disagreement that is understood and deliberately tolerated. Reported, never hidden. */
export interface AcceptedMismatch {
  /** Failure kinds as produced by `evaluateCase`: "security false alarm", "category", ... */
  kinds: string[];
  reason: string;
}

export interface EvalCase {
  id: string;
  source: EvalSource;
  note?: string;
  message: string;
  pullTitle?: string;
  expected: EvalExpectation;
  acceptedMismatch?: AcceptedMismatch;
  /** The label depends on product policy no one has decided yet. Never resolved by the implementer. */
  openPolicy?: string;
  provenance?: Provenance;
}
