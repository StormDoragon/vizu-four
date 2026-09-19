import { createHash } from "node:crypto";
import { isSimulationOnly } from "../deployment";
import type { JsonValue, ParseIssue } from "../workflow/types";
import { buildJobGraph } from "../workflow/graph";
import { expandMatrix, type MatrixCombo } from "../workflow/matrix";
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
    lanes: session.lanes,
    laneOrder: session.laneOrder,
    mockOutputs: session.mockOutputs,
    revision: session.revision,
    parseIssues: session.parseIssues,
    workflowHash: createHash("sha256").update(session.workflow.raw).digest("hex").slice(0, 16),
    simulationOnly: isSimulationOnly(),
  };
}
