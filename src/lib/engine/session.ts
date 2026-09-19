import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { JsonValue, ParseIssue, WorkflowFile, WorkflowStep } from "../workflow/types";
import { comboKey, expandMatrix } from "../workflow/matrix";
import { evaluateCondition, interpolate } from "../expressions/interpolate";
import {
  resolveEffectiveEnv,
  buildEvalContext,
  evaluateBooleanField,
  sessionTempRoot,
} from "./contexts";
import { executeRunStep } from "./stepRunner";
import { runSimulatedAction } from "./simulatedActions";
import { maskObjectStrings, maskSecrets } from "./masking";
import { EngineError } from "./errors";
import { defaultRunConfig } from "./defaults";
import { isSimulationOnly } from "../deployment";
import {
  breakpointKey,
  mockOutputsKey,
  type DebugSession,
  type Lane,
  type LaneStatus,
  type RunConfig,
  type StepMock,
  type StepRunRecord,
} from "./types";

const TERMINAL: ReadonlySet<LaneStatus> = new Set(["success", "failure", "skipped", "cancelled"]);
function isTerminal(status: LaneStatus): boolean {
  return TERMINAL.has(status);
}

/** One-line, length-capped rendering of a possibly multi-line script. */
function summarizeScript(script: string): string {
  const lines = script.trim().split("\n");
  const head = lines[0].slice(0, 200);
  const suffix = lines.length > 1 ? ` (+${lines.length - 1} more line${lines.length === 2 ? "" : "s"})` : "";
  return `${head}${head.length < lines[0].length ? "…" : ""}${suffix}`;
}

function stepDisplayName(step: WorkflowStep): string {
  if (step.name) return step.name;
  if (step.uses) return step.uses;
  if (step.run) return step.run.split("\n")[0].slice(0, 60);
  return step.key;
}

export interface CreateSessionOptions {
  workflow: WorkflowFile;
  workspaceDir: string;
  /** Owner cookie value of the visitor creating this session. */
  ownerId: string;
  config?: Partial<RunConfig>;
  /** Non-fatal warnings from the parse that produced `workflow`, carried
   * onto the session so they survive past the request that created it. */
  parseIssues?: ParseIssue[];
}

export function createSession(opts: CreateSessionOptions): DebugSession {
  const config: RunConfig = { ...defaultRunConfig(opts.workflow), ...opts.config };
  const session: DebugSession = {
    id: randomUUID(),
    ownerId: opts.ownerId,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    workflow: opts.workflow,
    workspaceDir: opts.workspaceDir,
    config,
    breakpoints: new Set(),
    breakOnFailure: true,
    lanes: {},
    laneOrder: [],
    activeLaneId: null,
    mockOutputs: {},
    revision: 0,
    parseIssues: opts.parseIssues ?? [],
  };

  for (const job of Object.values(opts.workflow.jobs)) {
    const combos = job.strategy?.matrix ? expandMatrix(job.strategy.matrix) : [{}];
    for (const combo of combos) {
      const laneId = `${job.id}::${comboKey(combo)}`;
      const lane: Lane = {
        id: laneId,
        jobId: job.id,
        matrix: combo,
        status: "blocked",
        pointer: 0,
        steps: job.steps.map((s) => ({
          key: s.key,
          id: s.id,
          name: stepDisplayName(s),
          status: "pending",
          continueOnError: false,
          outputs: {},
          stdout: "",
          stderr: "",
          combinedOutput: [],
        })),
        env: {},
        extraPath: [],
        outputs: {},
        tempDir: path.join(sessionTempRoot(session.id), "runner-temp", laneId.replace(/:/g, "_")),
      };
      session.lanes[laneId] = lane;
      session.laneOrder.push(laneId);
    }
  }

  recomputeLaneReadiness(session);
  session.activeLaneId = session.laneOrder[0] ?? null;
  return session;
}

function lanesForJob(session: DebugSession, jobId: string): Lane[] {
  return session.laneOrder.map((id) => session.lanes[id]).filter((l) => l.jobId === jobId);
}

function jobNeedsSatisfied(session: DebugSession, jobId: string): boolean {
  const job = session.workflow.jobs[jobId];
  return job.needs.every((dep) => {
    const lanes = lanesForJob(session, dep);
    return lanes.length > 0 && lanes.every((l) => isTerminal(l.status));
  });
}

/** Repeatedly unblocks lanes whose `needs` are satisfied, evaluating each job's `if:` gate. */
function recomputeLaneReadiness(session: DebugSession): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const lane of Object.values(session.lanes)) {
      if (lane.status !== "blocked") continue;
      if (!jobNeedsSatisfied(session, lane.jobId)) continue;
      activateLane(session, lane);
      changed = true;
    }
  }
}

function activateLane(session: DebugSession, lane: Lane): void {
  const job = session.workflow.jobs[lane.jobId];
  const anyDepFailure = job.needs.some((dep) =>
    lanesForJob(session, dep).some((l) => l.jobResult === "failure")
  );
  // GitHub skips a job by default not just when a dependency failed, but also
  // when one was itself skipped (e.g. by its own `if:`) - a job's implicit
  // default condition requires every job in `needs` to have *succeeded*, not
  // merely "not failed". Without `always()`/`!cancelled()` etc. in its own
  // `if:`, a skip propagates transitively down the whole needs chain.
  const allDepsSucceeded = job.needs.every((dep) =>
    lanesForJob(session, dep).every((l) => l.jobResult === "success")
  );
  const effectiveEnv = resolveEffectiveEnv(session, lane, 0, undefined);
  const evalCtx = buildEvalContext(session, lane, { uptoStepIndex: 0, effectiveEnv });
  // There's no way to cancel a session from outside it (no cancel endpoint
  // exists), so cancelled() can never legitimately be true here - hardcoded
  // rather than threaded through as dead, always-false session state.
  evalCtx.status = { anyFailure: anyDepFailure, cancelled: false };

  const cond =
    job.if === undefined
      ? { result: allDepsSucceeded }
      : evaluateCondition(job.if, evalCtx);

  if (!cond.result) {
    for (const s of lane.steps) {
      s.status = "skipped";
      s.outcome = "skipped";
      s.conclusion = "skipped";
    }
    lane.pointer = lane.steps.length;
    lane.jobResult = "skipped";
    lane.status = "skipped";
    lane.jobIfWarning = "alwaysTruthyWarning" in cond ? cond.alwaysTruthyWarning : undefined;
    finalizeLaneOutputs(session, lane);
  } else if (lane.steps.length === 0) {
    // A job with no steps has nothing to pause on - finalize it immediately
    // as successful instead of leaving it stuck in "running" forever (which
    // also deadlocked every job that `needs:` it, since nothing ever marks
    // this lane terminal).
    lane.jobResult = "success";
    lane.status = "success";
    finalizeLaneOutputs(session, lane);
  } else {
    lane.status = "ready";
  }
}

function finalizeLaneOutputs(session: DebugSession, lane: Lane): void {
  const job = session.workflow.jobs[lane.jobId];
  if (job.outputs) {
    const effectiveEnv = resolveEffectiveEnv(session, lane, lane.steps.length, undefined);
    const evalCtx = buildEvalContext(session, lane, {
      uptoStepIndex: lane.steps.length,
      effectiveEnv,
    });
    for (const [key, expr] of Object.entries(job.outputs)) {
      const { result } = interpolate(expr, evalCtx);
      lane.outputs[key] = maskSecrets(result, session.config.secrets);
    }
  }
  recomputeLaneReadiness(session);
}

/**
 * GitHub's default `strategy.fail-fast: true` cancels every other in-progress
 * or not-yet-started matrix combination of a job the moment any one of them
 * fails. Cancelled lanes get their remaining steps marked "cancelled" (not
 * "skipped" - that's reserved for `if:`-driven skips) rather than being left
 * to run to their own conclusion.
 */
function cancelSiblingLanesOnFailFast(session: DebugSession, failedLane: Lane): void {
  const job = session.workflow.jobs[failedLane.jobId];
  const failFast = job.strategy?.["fail-fast"] ?? true;
  if (!failFast) return;

  for (const lane of lanesForJob(session, failedLane.jobId)) {
    if (lane.id === failedLane.id || isTerminal(lane.status)) continue;
    for (const s of lane.steps) {
      if (s.status === "pending") {
        s.status = "skipped";
        s.outcome = "cancelled";
        s.conclusion = "cancelled";
      }
    }
    lane.pointer = lane.steps.length;
    lane.jobResult = "cancelled";
    lane.status = "cancelled";
    finalizeLaneOutputs(session, lane);
  }
}

function finishStepAdvance(session: DebugSession, lane: Lane, stepIndex: number): void {
  lane.pointer = stepIndex + 1;
  if (lane.pointer >= lane.steps.length) {
    // A concurrent request stepping a *different* matrix lane of this same
    // job may have already fail-fast-cancelled this one while this step was
    // in flight - don't let this step's own (now-moot) result clobber that.
    if (lane.status === "cancelled") return;
    const hasFailure = lane.steps.some((s) => s.conclusion === "failure");
    const allSkipped = lane.steps.every((s) => s.conclusion === "skipped");
    lane.jobResult = hasFailure ? "failure" : allSkipped ? "skipped" : "success";
    lane.status = lane.jobResult;
    finalizeLaneOutputs(session, lane);
    if (lane.jobResult === "failure") cancelSiblingLanesOnFailFast(session, lane);
  }
}

async function stepLane(session: DebugSession, laneId: string): Promise<StepRunRecord> {
  const lane = session.lanes[laneId];
  const job = session.workflow.jobs[lane.jobId];
  const stepIndex = lane.pointer;
  const step = job.steps[stepIndex];
  const record = lane.steps[stepIndex];

  record.status = "running";
  record.startedAt = new Date().toISOString();

  const effectiveEnv = resolveEffectiveEnv(session, lane, stepIndex, step.env);
  const evalCtx = buildEvalContext(session, lane, { uptoStepIndex: stepIndex, effectiveEnv });

  record.ifExpr = step.if;
  const cond =
    step.if === undefined
      ? { result: !evalCtx.status.anyFailure && !evalCtx.status.cancelled }
      : evaluateCondition(step.if, evalCtx);
  record.ifResult = cond.result;
  record.ifWarning = "alwaysTruthyWarning" in cond ? cond.alwaysTruthyWarning : undefined;
  record.ifError = "error" in cond ? cond.error : undefined;

  if (!cond.result) {
    record.status = "skipped";
    record.outcome = "skipped";
    record.conclusion = "skipped";
    record.endedAt = new Date().toISOString();
    finishStepAdvance(session, lane, stepIndex);
    return record;
  }

  record.continueOnError = evaluateBooleanField(step["continue-on-error"], evalCtx);

  const runMock =
    step.run !== undefined ? session.mockOutputs[mockOutputsKey(lane.jobId, step.key)] : undefined;

  if (step.run !== undefined) {
    const { result: script, errors: scriptErrors } = interpolate(step.run, evalCtx);
    if (scriptErrors.length > 0) {
      record.engineError = `Could not evaluate expression(s) in 'run': ${scriptErrors
        .map((e) => e.message)
        .join("; ")}`;
      record.outcome = "failure";
    } else if (runMock || isSimulationOnly()) {
      // Either the user mocked this step, or this deployment never spawns.
      // Showing the fully-interpolated command is the useful part anyway:
      // it's what the expression engine resolved, which is most of what a
      // debugger is for. Masked, since interpolation may have pulled a
      // secret into it.
      record.simulated = true;
      record.simulationNote = maskSecrets(
        `${runMock ? "Mocked" : "Not executed"}: ${
          runMock
            ? "this step's result is stubbed, so it was not run."
            : "this deployment runs in simulation-only mode."
        } After interpolation the command would have been: ${summarizeScript(script)}`,
        session.config.secrets
      );
      record.exitCode = 0;
      record.outcome = "success";
      if (runMock) applyStepMock(record, runMock, session.config.secrets);
    } else {
      const workDirRaw = step["working-directory"]
        ? interpolate(step["working-directory"], evalCtx).result
        : undefined;
      const cwd = workDirRaw ? path.resolve(session.workspaceDir, workDirRaw) : session.workspaceDir;
      await fs.mkdir(lane.tempDir, { recursive: true });
      const runResult = await executeRunStep({
        script,
        shell: step.shell,
        cwd,
        env: effectiveEnv,
        extraPath: lane.extraPath,
        runnerTempDir: lane.tempDir,
        timeoutMs:
          typeof step["timeout-minutes"] === "number"
            ? step["timeout-minutes"] * 60_000
            : undefined,
      });
      record.exitCode = runResult.exitCode;
      record.stdout = maskSecrets(runResult.stdout, session.config.secrets);
      record.stderr = maskSecrets(runResult.stderr, session.config.secrets);
      record.combinedOutput = runResult.combined.map((chunk) => ({
        stream: chunk.stream,
        text: maskSecrets(chunk.text, session.config.secrets),
      }));
      record.summary = runResult.summary
        ? maskSecrets(runResult.summary, session.config.secrets)
        : undefined;
      record.outputs = maskObjectStrings(runResult.outputs, session.config.secrets);

      if (runResult.spawnError) {
        record.engineError = runResult.spawnError;
        record.outcome = "failure";
      } else if (runResult.timedOut) {
        record.engineError = "Step timed out";
        record.outcome = "failure";
      } else {
        record.outcome = runResult.exitCode === 0 ? "success" : "failure";
      }
      lane.env = { ...lane.env, ...runResult.envAdditions };
      lane.extraPath = [...runResult.pathAdditions, ...lane.extraPath];
    }
  } else if (step.uses !== undefined) {
    const withInputs: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(step.with ?? {})) {
      withInputs[k] = typeof v === "string" ? interpolate(v, evalCtx).result : v;
    }
    const artifactsDir = path.join(session.workspaceDir, ".debugger", "artifacts");
    const simResult = runSimulatedAction(step.uses, withInputs, session.workspaceDir, artifactsDir);
    record.simulated = true;
    // simResult.note can legitimately echo back `with:` input values (e.g. a
    // registry username) that a workflow commonly sources from `secrets.*` -
    // mask it the same as every other client-visible surface.
    record.simulationNote = maskSecrets(simResult.note, session.config.secrets);

    const mock = session.mockOutputs[mockOutputsKey(lane.jobId, step.key)];
    record.outputs = maskObjectStrings(simResult.outputs, session.config.secrets);
    record.outcome = simResult.conclusion;
    record.exitCode = simResult.conclusion === "success" ? 0 : 1;
    if (mock) applyStepMock(record, mock, session.config.secrets, simResult.outputs);
  } else {
    record.engineError = "Step has neither 'run' nor 'uses'";
    record.outcome = "failure";
  }

  record.conclusion =
    record.outcome === "failure" && record.continueOnError ? "success" : record.outcome;
  record.status = record.conclusion === "failure" ? "failure" : "success";
  record.endedAt = new Date().toISOString();
  record.durationMs =
    new Date(record.endedAt).getTime() - new Date(record.startedAt ?? record.endedAt).getTime();

  finishStepAdvance(session, lane, stepIndex);
  return record;
}

function requireLane(session: DebugSession, laneId: string): Lane {
  const lane = session.lanes[laneId];
  if (!lane) throw new EngineError(`Unknown lane '${laneId}'`);
  return lane;
}

export async function controlStep(session: DebugSession, laneId: string): Promise<StepRunRecord> {
  const lane = requireLane(session, laneId);
  if (lane.status === "blocked") throw new EngineError("Lane is blocked on 'needs'");
  // Checked and flipped synchronously (no `await` between the check and the
  // write below), so two requests racing to step the same lane can't both
  // pass this guard - the JS event loop can't interleave them here.
  if (lane.status === "running") throw new EngineError("Lane is already running");
  if (isTerminal(lane.status)) throw new EngineError("Lane has already finished");
  lane.status = "running";
  const record = await stepLane(session, laneId);
  if (!isTerminal(lane.status)) lane.status = "paused";
  session.revision++;
  return record;
}

async function runLaneLoop(
  session: DebugSession,
  laneId: string,
  opts: { respectBreakpoints: boolean; respectFailureStop: boolean }
): Promise<void> {
  const lane = requireLane(session, laneId);
  if (lane.status === "blocked") throw new EngineError("Lane is blocked on 'needs'");
  // Same synchronous check-then-flip guard as controlStep - see comment there.
  if (lane.status === "running") throw new EngineError("Lane is already running");
  if (isTerminal(lane.status)) return;

  const job = session.workflow.jobs[lane.jobId];
  lane.status = "running";
  let executedAtLeastOne = false;

  try {
    while (lane.pointer < lane.steps.length) {
      const stepKey = job.steps[lane.pointer].key;
      if (
        opts.respectBreakpoints &&
        executedAtLeastOne &&
        session.breakpoints.has(breakpointKey(lane.jobId, stepKey))
      ) {
        lane.status = "paused";
        return;
      }
      const record = await stepLane(session, laneId);
      executedAtLeastOne = true;
      if (isTerminal(lane.status)) return;
      if (opts.respectFailureStop && record.conclusion === "failure") {
        lane.status = "paused";
        return;
      }
    }
  } finally {
    session.revision++;
  }
}

export function controlContinue(session: DebugSession, laneId: string): Promise<void> {
  return runLaneLoop(session, laneId, {
    respectBreakpoints: true,
    respectFailureStop: session.breakOnFailure,
  });
}

export function controlRunToEnd(session: DebugSession, laneId: string): Promise<void> {
  return runLaneLoop(session, laneId, {
    respectBreakpoints: false,
    respectFailureStop: session.breakOnFailure,
  });
}

/** Drives every lane in the graph to completion, ignoring breakpoints entirely. */
export async function controlRunAll(session: DebugSession): Promise<void> {
  recomputeLaneReadiness(session);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const laneId of session.laneOrder) {
      const lane = session.lanes[laneId];
      if (lane.status === "ready" || lane.status === "paused") {
        await runLaneLoop(session, laneId, { respectBreakpoints: false, respectFailureStop: false });
        progressed = true;
      }
    }
  }
}

export function setBreakpoint(
  session: DebugSession,
  jobId: string,
  stepKey: string,
  enabled: boolean
): void {
  const key = breakpointKey(jobId, stepKey);
  if (enabled) session.breakpoints.add(key);
  else session.breakpoints.delete(key);
  session.revision++;
}

/**
 * Defines (or clears, with `outputs: null`) mocked outputs for a `uses:`
 * step, scoped to job+step like breakpoints so it applies across every
 * matrix lane of that job. Takes effect on the next execution of that step
 * in any lane - like What-If, it never rewrites an already-recorded run.
 */
export function setMockOutputs(
  session: DebugSession,
  jobId: string,
  stepKey: string,
  mock: StepMock | null
): void {
  const key = mockOutputsKey(jobId, stepKey);
  // A mock that changes nothing is the same as no mock - otherwise clearing
  // the last row would leave an empty mock that still suppresses execution.
  const changesNothing =
    !mock ||
    (Object.keys(mock.outputs ?? {}).length === 0 &&
      (mock.exitCode === undefined || mock.exitCode === 0) &&
      !mock.stderr);
  if (changesNothing) {
    delete session.mockOutputs[key];
  } else {
    session.mockOutputs[key] = {
      outputs: mock.outputs ?? {},
      exitCode: mock.exitCode,
      stderr: mock.stderr,
    };
  }
  session.revision++;
}

/**
 * Folds a mock into a step's record. Outputs merge over whatever the caller
 * already produced; the outcome is only overridden when the mock states an
 * exit code, so mocking outputs alone doesn't silently force success.
 */
function applyStepMock(
  record: StepRunRecord,
  mock: StepMock,
  secrets: Record<string, string>,
  baseOutputs: Record<string, string> = {}
): void {
  record.outputs = maskObjectStrings({ ...baseOutputs, ...mock.outputs }, secrets);
  record.mockedOutputKeys = Object.keys(mock.outputs);
  if (mock.stderr) {
    const masked = maskSecrets(mock.stderr, secrets);
    record.stderr = masked;
    record.combinedOutput = [{ stream: "stderr", text: masked }];
  }
  if (mock.exitCode !== undefined) {
    record.exitCode = mock.exitCode;
    record.outcome = mock.exitCode === 0 ? "success" : "failure";
  }
}

export interface WhatIfPatch {
  env?: Record<string, string | null>;
  vars?: Record<string, string | null>;
  secrets?: Record<string, string | null>;
  inputs?: Record<string, JsonValue | null>;
  event?: JsonValue;
  eventName?: string;
  ref?: string;
  breakOnFailure?: boolean;
}

/** Applies a patch where a `null` value removes the key instead of overwriting it. */
function applyKeyedPatch<T>(
  target: Record<string, T>,
  patch: Record<string, T | null> | undefined
): void {
  if (!patch) return;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else target[key] = value;
  }
}

/** Mutates live session config; takes effect on the next step executed in any lane. */
export function applyWhatIf(session: DebugSession, patch: WhatIfPatch): void {
  applyKeyedPatch(session.config.envOverrides, patch.env);
  applyKeyedPatch(session.config.vars, patch.vars);
  applyKeyedPatch(session.config.secrets, patch.secrets);
  applyKeyedPatch(session.config.workflowInputs, patch.inputs);
  if (patch.event !== undefined) session.config.event = patch.event;
  if (patch.eventName !== undefined) session.config.eventName = patch.eventName;
  if (patch.ref !== undefined) session.config.ref = patch.ref;
  if (patch.breakOnFailure !== undefined) session.breakOnFailure = patch.breakOnFailure;
  session.revision++;
}

export function setActiveLane(session: DebugSession, laneId: string): void {
  requireLane(session, laneId);
  session.activeLaneId = laneId;
}

export { isTerminal };
