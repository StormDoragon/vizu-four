import type { JsonValue, WorkflowFile } from "../workflow/types";
import type { MatrixCombo } from "../workflow/matrix";

export type Conclusion = "success" | "failure" | "skipped" | "cancelled";

export interface StepRunRecord {
  /** Internal identity, used for breakpoints/mock-outputs/matrix highlighting -
   * falls back to a synthetic `step-N` when the workflow gives no explicit `id`. */
  key: string;
  /** The workflow's own explicit `id:`, if any - only steps with one are
   * addressable via the `steps.*` expression context, matching real GitHub. */
  id?: string;
  name: string;
  status: "pending" | "running" | "success" | "failure" | "skipped";
  ifExpr?: string;
  ifResult?: boolean;
  ifWarning?: string;
  ifError?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  outcome?: Conclusion;
  conclusion?: Conclusion;
  continueOnError: boolean;
  outputs: Record<string, string>;
  stdout: string;
  stderr: string;
  /** stdout/stderr interleaved in arrival order, for a chronological combined view. */
  combinedOutput: { stream: "stdout" | "stderr"; text: string }[];
  summary?: string;
  simulated?: boolean;
  simulationNote?: string;
  engineError?: string;
  /** Output keys that came from a user-defined mock rather than the simulator itself. */
  mockedOutputKeys?: string[];
}

export type LaneStatus =
  | "blocked"
  | "ready"
  | "running"
  | "paused"
  | "success"
  | "failure"
  | "skipped"
  | "cancelled";

export interface Lane {
  id: string;
  jobId: string;
  matrix: MatrixCombo;
  status: LaneStatus;
  pointer: number;
  steps: StepRunRecord[];
  env: Record<string, string>;
  extraPath: string[];
  outputs: Record<string, string>;
  jobResult?: Conclusion;
  jobIfWarning?: string;
  /** This lane's `$RUNNER_TEMP`/`runner.temp` dir - same path for both, unlike a real
   * per-step scratch dir; created on disk lazily before the first run: step needs it. */
  tempDir: string;
}

export interface RunConfig {
  eventName: string;
  event: JsonValue;
  ref: string;
  sha: string;
  actor: string;
  repository: string;
  runId: string;
  runNumber: string;
  workflowInputs: Record<string, JsonValue>;
  vars: Record<string, string>;
  secrets: Record<string, string>;
  envOverrides: Record<string, string>;
}

export interface DebugSession {
  id: string;
  createdAt: string;
  /** Bumped on every read/write via the store; drives idle-session reaping. */
  lastAccessedAt: string;
  workflow: WorkflowFile;
  workspaceDir: string;
  config: RunConfig;
  breakpoints: Set<string>;
  breakOnFailure: boolean;
  lanes: Record<string, Lane>;
  laneOrder: string[];
  activeLaneId: string | null;
  cancelled: boolean;
  events: string[];
  /** User-defined output stubs for `uses:` steps, keyed by mockOutputsKey(jobId, stepKey). */
  mockOutputs: Record<string, Record<string, string>>;
}

export function breakpointKey(jobId: string, stepKey: string): string {
  return `${jobId}:${stepKey}`;
}

export function mockOutputsKey(jobId: string, stepKey: string): string {
  return `${jobId}:${stepKey}`;
}
