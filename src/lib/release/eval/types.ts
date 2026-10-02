import type { ReleaseChange } from "../types";

/**
 * "synthetic" cases are hand-written by the implementer to probe known-hard metadata shapes.
 * Only "maintainer-reviewed" cases (labels confirmed by a project maintainer for a real range)
 * may be cited as evidence of real-world accuracy; metrics are always reported per source.
 */
export type EvalSource = "synthetic" | "maintainer-reviewed";

export interface EvalExpectation {
  releaseWorthy: boolean;
  /** Omit when any category is acceptable as long as inclusion is right. */
  category?: ReleaseChange["category"];
  securitySensitive?: boolean;
  breakingChange?: boolean;
}

export interface EvalCase {
  id: string;
  source: EvalSource;
  note?: string;
  message: string;
  pullTitle?: string;
  expected: EvalExpectation;
}
