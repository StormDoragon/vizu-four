export interface ReleaseInput {
  repository: string;
  base: string;
  head: string;
  useAi: boolean;
}

export interface Evidence {
  id: string;
  kind: "commit" | "pull_request" | "file";
  label: string;
  url: string;
}

export interface CollectedCommit {
  sha: string;
  message: string;
  evidence: Evidence[];
  pullTitle?: string;
  /** Detected before source text is truncated; a PR title cannot erase these flags. */
  reviewFlags?: { securitySensitive: boolean; breakingChange: boolean };
}

export interface ReleaseCollection {
  repository: string;
  baseSha: string;
  headSha: string;
  compareUrl: string;
  commits: CollectedCommit[];
  files: Evidence[];
  warnings: string[];
}

export interface ReleaseChange {
  id: string;
  title: string;
  category: "added" | "fixed" | "improved" | "documentation" | "security" | "breaking" | "internal" | "other";
  impact: "customer" | "developer" | "internal" | "unknown";
  importance: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  securitySensitive: boolean;
  breakingChange: boolean;
  releaseWorthy: boolean;
  reason: string;
  evidence: Evidence[];
  technical: string;
  customer: string;
}

export interface ReleaseAnalysis extends Omit<ReleaseCollection, "commits"> {
  changes: ReleaseChange[];
  source: "deterministic" | "claude";
}

export interface ReleaseResult {
  analysis: ReleaseAnalysis;
  notes: { technical: string; customer: string };
}
