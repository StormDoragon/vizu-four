import { createHash } from "node:crypto";
import { isSimulationOnly } from "../deployment";
import type { JsonValue, ParseIssue } from "../workflow/types";
import { buildJobGraph } from "../workflow/graph";
import { expandMatrix, type MatrixCombo } from "../workflow/matrix";
import { maskObjectStrings, secretsToMask } from "./masking";
import type { DebugSession, Lane, StepMock } from "./types";

export interface SessionViewStep {
  key: string;
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  shell?: string;
}

export interface SessionViewJob {
  id: string;
  name?: string;
  needs: string[];
  if?: string;
  matrix: MatrixCombo[] | null;
  steps: SessionViewStep[];
}

export interface SessionView {
  id: string;
  createdAt: string;
  workflow: {
    name?: string;
    on: JsonValue;
    jobs: Record<string, SessionViewJob>;
  };
  graph: { levels: string[][]; cycles: string[][] };
  config: {
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
    /** Secret values are never serialized to the client - only their names. */
    secretNames: string[];
    envOverrides: Record<string, string>;
  };
  breakpoints: string[];
  breakOnFailure: boolean;
  activeLaneId: string | null;
  lanes: Record<string, Lane>;
  laneOrder: string[];
  /** User-defined output stubs for `uses:` steps, keyed by `${jobId}:${stepKey}`. */
  mockOutputs: Record<string, StepMock>;
  /** Bumped on every session mutation - use as a cache-invalidation key
   * instead of an unrelated field like the active lane's pointer. */
  revision: number;
  /** Non-fatal warnings from parsing this session's workflow. */
  parseIssues: ParseIssue[];
  /** Content hash of the workflow source. Client-side persistence keys off
   * this rather than the session id: a new session always gets a new id, so
   * id-keyed storage could never restore anything. Editing the workflow
   * yields a new hash and therefore a clean slate, which is the safe
   * default given breakpoints reference step keys that may have moved. */
  workflowHash: string;
  /** True when this deployment never spawns `run:` steps, so the UI can say
   * so rather than letting someone read simulated successes as real ones. */
  simulationOnly: boolean;
  /** True when `run:` steps in this session execute against a real
   * directory on disk the user opted into, not a disposable scratch dir -
   * the UI shows this so a real write is never mistaken for a throwaway one. */
  usesRealWorkspace: boolean;
  /** True when this session came from a share link and has not been allowed
   * to execute yet - the UI offers inspecting it without running. */
  awaitingExecutionConsent: boolean;
}

/**
 * Lanes as the client may see them.
 *
 * A step's own record is masked when it is written, but two lane fields are
 * deliberately kept raw because execution needs the real values: `env`
 * accumulates what steps wrote to `$GITHUB_ENV`, and `extraPath` what they
 * wrote to `$GITHUB_PATH`. Both are resolved into the environment of every
 * later step, so masking them at the point of capture would run the rest of
 * the job against `***`. Masking belongs here instead - the one place lane
 * state crosses from the engine to the client.
 */
function toClientLanes(session: DebugSession): Record<string, Lane> {
  const secrets = secretsToMask(session.config.secrets, session.retiredSecretValues);
  const out: Record<string, Lane> = {};
  for (const [id, lane] of Object.entries(session.lanes)) {
    out[id] = {
      ...lane,
      env: maskObjectStrings(lane.env, secrets),
      extraPath: maskObjectStrings(lane.extraPath, secrets),
      // The per-step environment snapshots stay server-side: the context
      // endpoint serves them (masked) for the one step being inspected,
      // rather than every session payload carrying one env map per step per
      // lane - which is also one fewer copy of them to redact.
      steps: lane.steps.map(({ envBefore, envAfter, ...step }) => {
        void envBefore;
        void envAfter;
        return step;
      }),
    };
  }
  return out;
}

export function toSessionView(session: DebugSession): SessionView {
  const graph = buildJobGraph(session.workflow);

  const jobs: Record<string, SessionViewJob> = {};
  for (const [id, job] of Object.entries(session.workflow.jobs)) {
    jobs[id] = {
      id: job.id,
      name: job.name,
      needs: job.needs,
      if: job.if,
      matrix: job.strategy?.matrix ? expandMatrix(job.strategy.matrix) : null,
      steps: job.steps.map((s) => ({
        key: s.key,
        name: s.name,
        if: s.if,
        uses: s.uses,
        run: s.run,
        shell: s.shell,
      })),
    };
  }

  return {
    id: session.id,
    createdAt: session.createdAt,
    workflow: {
      name: session.workflow.name,
      on: session.workflow.on,
      jobs,
    },
    graph: { levels: graph.levels, cycles: graph.cycles },
    config: {
      eventName: session.config.eventName,
      event: session.config.event,
      ref: session.config.ref,
      sha: session.config.sha,
      actor: session.config.actor,
      repository: session.config.repository,
      runId: session.config.runId,
      runNumber: session.config.runNumber,
      workflowInputs: session.config.workflowInputs,
      vars: session.config.vars,
      secretNames: Object.keys(session.config.secrets),
      envOverrides: session.config.envOverrides,
    },
    breakpoints: [...session.breakpoints],
    breakOnFailure: session.breakOnFailure,
    activeLaneId: session.activeLaneId,
    lanes: toClientLanes(session),
    laneOrder: session.laneOrder,
    mockOutputs: session.mockOutputs,
    revision: session.revision,
    parseIssues: session.parseIssues,
    workflowHash: createHash("sha256").update(session.workflow.raw).digest("hex").slice(0, 16),
    simulationOnly: isSimulationOnly(),
    usesRealWorkspace: session.usesRealWorkspace,
    awaitingExecutionConsent: session.awaitingExecutionConsent,
  };
}
