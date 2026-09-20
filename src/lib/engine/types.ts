import type { JsonValue, ParseIssue, WorkflowFile } from "../workflow/types";
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
  /**
   * The environment actually supplied to this step when it ran, including
   * its own `env:` layer - not recomputed on demand.
   *
   * Recomputing produced a view of the past built from the present: a later
   * step writing `$GITHUB_ENV`, or a What-If override applied afterwards,
   * rewrote what every earlier step appeared to have seen. Kept raw, like
   * `Lane.env`, and redacted where it reaches the client.
   */
  envBefore?: Record<string, string>;
  /**
   * The environment a following step would inherit, as it stood when this
   * step finished: the workflow and job layers, plus everything persisted
   * to `$GITHUB_ENV` up to here, plus What-If overrides in effect at the
   * time. Not the bare `$GITHUB_ENV` additions - those are `Lane.env` - and
   * not the next step's own `env:` layer, which is applied on top when that
   * step runs.
   */
  envAfter?: Record<string, string>;
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
  /** Opaque per-visitor id from the owner cookie. Every `[id]` route checks
   * it, so knowing a session id is not by itself enough to reach a session. */
  ownerId: string;
  createdAt: string;
  /** Bumped on every read/write via the store; drives idle-session reaping. */
  lastAccessedAt: string;
  workflow: WorkflowFile;
  workspaceDir: string;
  /** True when `workspaceDir` is a real directory on disk the user chose to
   * debug against - an opt-in "run against this repo" session - rather than
   * a disposable `mkdtemp` scratch dir. Session cleanup must never `rm` this
   * directory, and it's why the artifact-simulation scratch space lives
   * under the session's temp root instead of inside `workspaceDir`: this is
   * someone's real working tree, not a throwaway copy. */
  usesRealWorkspace: boolean;
  /** True while a session created from a share link has not been given
   * permission to execute. A link carries someone else's workflow and the
   * progress to replay, and opening one used to run both immediately - on a
   * local install with real execution on, that is a stranger's shell
   * commands on a click.
   *
   * Scope: the flag is set from a client-supplied field on session creation,
   * so this stops the sharing flow from executing without a decision. It is
   * not authentication - a caller writing its own requests can simply not
   * set it, exactly as it could always create a session directly. What it
   * guarantees is that following a link never runs anything on its own. */
  awaitingExecutionConsent: boolean;
  config: RunConfig;
  /** Secret values that were in `config.secrets` earlier in this session and
   * have since been replaced or removed. Append-only: recorded output and
   * environment snapshots still hold them, and those are redacted on read,
   * so dropping a value from the live map must not un-redact the past. */
  retiredSecretValues: string[];
  breakpoints: Set<string>;
  breakOnFailure: boolean;
  lanes: Record<string, Lane>;
  laneOrder: string[];
  activeLaneId: string | null;
  /** User-defined stubs keyed by mockOutputsKey(jobId, stepKey). A mocked
   * step is never executed - the mock decides its result outright. */
  mockOutputs: Record<string, StepMock>;
  /** Bumped on every session mutation (step execution, breakpoints, mock
   * outputs, What-If) - a cheap, always-correct "has anything changed"
   * signal for clients to key cache invalidation off, instead of trying to
   * infer staleness from an unrelated field like the active lane's pointer. */
  revision: number;
  /** Non-fatal warnings from parsing this session's workflow (e.g. an
   * unknown `needs`, a step with neither `run` nor `uses`) - the session
   * outlives the create-and-navigate round trip that computed them, so
   * they're not lost the moment the create page unmounts. */
  parseIssues: ParseIssue[];
}

/**
 * A stand-in for actually running a step. Applies to `uses:` steps (which
 * are always simulated) and to `run:` steps (which a mock takes over from,
 * rather than executing).
 */
export interface StepMock {
  outputs: Record<string, string>;
  /** Non-zero marks the step failed, which is what exercises
   * `continue-on-error`, `if: failure()`, the failure panel and the
   * explain endpoint. Omitted means "don't override the natural outcome". */
  exitCode?: number;
  /** Stderr for a mocked failure, so there's something to diagnose. */
  stderr?: string;
}

export function breakpointKey(jobId: string, stepKey: string): string {
  return `${jobId}:${stepKey}`;
}

export function mockOutputsKey(jobId: string, stepKey: string): string {
  return `${jobId}:${stepKey}`;
}
