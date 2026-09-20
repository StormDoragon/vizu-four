import os from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import type { JsonValue } from "../workflow/types";
import { evaluateExpression, type EvalContext } from "../expressions/evaluator";
import { findExpressionSpans, interpolate } from "../expressions/interpolate";
import { toBoolean } from "../expressions/coerce";
import type { Conclusion, DebugSession, Lane } from "./types";

function lanesForJob(session: DebugSession, jobId: string): Lane[] {
  return session.laneOrder
    .map((id) => session.lanes[id])
    .filter((lane) => lane.jobId === jobId);
}

/** Root of every temp path this session creates on disk - swept on session cleanup. */
export function sessionTempRoot(sessionId: string): string {
  return path.join(os.tmpdir(), "actions-debugger", sessionId);
}

/**
 * A lane's `$RUNNER_TEMP` directory, always inside the session's temp root.
 *
 * The lane id embeds matrix values, which are workflow-author input, so it
 * cannot be joined into a path as-is: a matrix value of `../../../../tmp/x`
 * made `path.join` resolve the lane's temp directory to `/tmp/x` - outside
 * the session root, created on disk, and handed to every `run:` step in that
 * lane as `$RUNNER_TEMP`. Everything outside a conservative character set is
 * therefore percent-encoded, and the name is capped with a digest of the
 * full id so that two lanes whose names truncate or sanitize alike still get
 * separate directories.
 */
export function laneTempDir(sessionId: string, laneId: string): string {
  const safe = laneId.replace(/[^A-Za-z0-9._-]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`
  );
  const digest = createHash("sha256").update(laneId).digest("hex").slice(0, 8);
  return path.join(sessionTempRoot(sessionId), "runner-temp", `${safe.slice(0, 80)}-${digest}`);
}


function flattenRunsOnLabels(runsOn: JsonValue): string[] {
  if (typeof runsOn === "string") return [runsOn];
  if (Array.isArray(runsOn)) return runsOn.filter((v): v is string => typeof v === "string");
  if (runsOn && typeof runsOn === "object" && !Array.isArray(runsOn)) {
    const labels = (runsOn as Record<string, JsonValue>).labels;
    return flattenRunsOnLabels(labels ?? null);
  }
  return [];
}

/**
 * `run:` steps always execute on this machine's real OS - full cross-OS
 * emulation is out of scope - but deriving `runner.os` from the job's
 * declared `runs-on` (rather than hardcoding "Linux") is nearly free and
 * makes `if: runner.os == 'Windows'`-style branches in a matrix-over-OS
 * workflow evaluate the way they would on the real runner, even though the
 * shell underneath is still this host's.
 *
 * `ctx` resolves `${{ }}` in the labels first. Without it the single most
 * common way to write such a workflow - `runs-on: ${{ matrix.os }}` over an
 * `os` axis - derived from the literal template text, which matches no
 * label, so every lane reported "Linux" and the OS branches the matrix
 * exists to exercise all took the same path. A label that fails to
 * interpolate falls back to its raw text rather than dropping out.
 */
export function deriveRunnerOs(
  runsOn: JsonValue,
  ctx?: EvalContext
): "Linux" | "Windows" | "macOS" {
  const labels = flattenRunsOnLabels(runsOn).map((label) => {
    if (!ctx) return label.toLowerCase();
    try {
      return interpolate(label, ctx).result.toLowerCase();
    } catch {
      return label.toLowerCase();
    }
  });
  if (labels.some((l) => l.includes("windows"))) return "Windows";
  if (labels.some((l) => l.includes("macos") || l.includes("mac-os") || l.includes("darwin"))) {
    return "macOS";
  }
  return "Linux";
}

/**
 * Aggregates a job's result across every matrix lane. When lanes finish at
 * different times and disagree on outputs, GitHub's own documented
 * (slightly surprising) behavior is "last writer wins" - we replicate that
 * rather than pretending it's well-defined.
 */
function aggregateJob(lanes: Lane[]): { result: Conclusion; outputs: Record<string, string> } {
  let result: Conclusion = "success";
  const outputs: Record<string, string> = {};
  for (const lane of lanes) {
    if (lane.jobResult === "failure") result = "failure";
    else if (lane.jobResult === "cancelled" && result !== "failure") result = "cancelled";
    Object.assign(outputs, lane.outputs);
  }
  if (result === "success" && lanes.length > 0 && lanes.every((l) => l.jobResult === "skipped")) {
    result = "skipped";
  }
  return { result, outputs };
}

function getNestedString(obj: JsonValue, path: string[]): string {
  let cur: JsonValue = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return "";
    cur = (cur as Record<string, JsonValue>)[key] ?? null;
  }
  return typeof cur === "string" ? cur : "";
}

export interface BuildContextsOptions {
  /** Steps up to (not including) this index are visible in `steps.*`. */
  uptoStepIndex: number;
  /** Env as seen by the step currently being evaluated (see buildEnvForStep). */
  effectiveEnv: Record<string, string>;
}

export function buildEvalContext(
  session: DebugSession,
  lane: Lane,
  opts: BuildContextsOptions
): EvalContext {
  const job = session.workflow.jobs[lane.jobId];
  const cfg = session.config;

  // Real GitHub only exposes a step under `steps.*` when it has an explicit
  // `id:` - a step without one genuinely isn't addressable there, even
  // though the engine still tracks it internally (breakpoints, mock
  // outputs, matrix highlighting) via its synthetic `step-N` key.
  const stepsContext: Record<string, JsonValue> = {};
  for (const record of lane.steps.slice(0, opts.uptoStepIndex)) {
    if (!record.id) continue;
    stepsContext[record.id] = {
      outputs: record.outputs,
      outcome: record.outcome ?? "skipped",
      conclusion: record.conclusion ?? "skipped",
    };
  }

  const needsContext: Record<string, JsonValue> = {};
  for (const dep of job.needs) {
    const { result, outputs } = aggregateJob(lanesForJob(session, dep));
    needsContext[dep] = { result, outputs };
  }

  const anyFailure = lane.steps
    .slice(0, opts.uptoStepIndex)
    .some((s) => s.conclusion === "failure");

  // GitHub only populates these for pull_request(_target)-triggered runs;
  // every other event genuinely gets empty strings, not nulls.
  const isPrEvent = cfg.eventName === "pull_request" || cfg.eventName === "pull_request_target";
  const headRef = isPrEvent ? getNestedString(cfg.event, ["pull_request", "head", "ref"]) : "";
  const baseRef = isPrEvent ? getNestedString(cfg.event, ["pull_request", "base", "ref"]) : "";

  const contexts: Record<string, JsonValue> = {
    github: {
      event_name: cfg.eventName,
      event: cfg.event,
      ref: cfg.ref,
      sha: cfg.sha,
      actor: cfg.actor,
      repository: cfg.repository,
      repository_owner: cfg.repository.split("/")[0] ?? "",
      run_id: cfg.runId,
      run_number: cfg.runNumber,
      run_attempt: "1",
      workflow: session.workflow.name ?? "workflow",
      job: lane.jobId,
      workspace: session.workspaceDir,
      server_url: "https://github.com",
      api_url: "https://api.github.com",
      ref_name: cfg.ref.replace(/^refs\/(heads|tags)\//, ""),
      ref_type: cfg.ref.startsWith("refs/tags/") ? "tag" : cfg.ref.startsWith("refs/heads/") ? "branch" : "",
      head_ref: headRef,
      base_ref: baseRef,
      triggering_actor: cfg.actor,
    },
    env: opts.effectiveEnv,
    vars: cfg.vars,
    secrets: cfg.secrets,
    matrix: lane.matrix,
    needs: needsContext,
    steps: stepsContext,
    runner: {
      // Provisional: `runs-on` may interpolate, and interpolating needs the
      // rest of this context. Overwritten below, once it exists.
      os: "Linux",
      arch: "X64",
      name: "Debugger Local Runner",
      // Same path the spawned process actually sees as $RUNNER_TEMP (see
      // stepRunner.ts) - previously this was a different, never-created
      // path, so `${{ runner.temp }}` and `$RUNNER_TEMP` disagreed.
      temp: lane.tempDir,
      tool_cache: path.join(sessionTempRoot(session.id), "tool-cache"),
      debug: "0",
    },
    job: {
      status: anyFailure ? "failure" : "success",
    },
    inputs: cfg.workflowInputs,
    strategy: {
      "fail-fast": job.strategy?.["fail-fast"] ?? true,
    },
  };

  const ctx: EvalContext = {
    contexts,
    // There's no way to cancel a session (no cancel endpoint exists), so
    // cancelled() can never legitimately be true - hardcoded rather than
    // threaded through as dead, always-false session state.
    status: { anyFailure, cancelled: false },
    cwd: session.workspaceDir,
  };

  // Now that the context exists, resolve `runs-on` against it - `${{
  // matrix.os }}` is the usual spelling and needs `matrix` to be populated.
  // A self-referential `runs-on: ${{ runner.os }}` would read the
  // provisional value above; GitHub rejects that outright, so there is no
  // correct answer to preserve.
  (contexts.runner as Record<string, JsonValue>).os = deriveRunnerOs(job["runs-on"], ctx);

  return ctx;
}

/**
 * Resolves the effective `env` for a step (or for job-level evaluation when
 * `stepEnv` is omitted), applying layers in GitHub's precedence order -
 * workflow, job, `$GITHUB_ENV` accumulated so far, what-if overrides, then
 * the step's own `env:` - and interpolating `${{ }}` in each layer as it's
 * applied, so e.g. `env: { TOKEN: ${{ secrets.TOKEN }} }` actually resolves
 * instead of passing the literal template through. Values already known to
 * be plain strings (`$GITHUB_ENV` additions, what-if overrides) are applied
 * verbatim. Later layers can reference earlier ones via `env.*`.
 */
export function resolveEffectiveEnv(
  session: DebugSession,
  lane: Lane,
  uptoStepIndex: number,
  stepEnv: Record<string, string> | undefined
): Record<string, string> {
  const job = session.workflow.jobs[lane.jobId];
  const env: Record<string, string> = {};

  const applyLayer = (raw: Record<string, string> | undefined, shouldInterpolate: boolean) => {
    if (!raw) return;
    for (const [key, value] of Object.entries(raw)) {
      if (shouldInterpolate) {
        const ctx = buildEvalContext(session, lane, { uptoStepIndex, effectiveEnv: env });
        env[key] = interpolate(value, ctx).result;
      } else {
        env[key] = value;
      }
    }
  };

  applyLayer(session.workflow.env, true);
  applyLayer(job.env, true);
  applyLayer(lane.env, false); // already-resolved values captured from $GITHUB_ENV
  applyLayer(session.config.envOverrides, false); // literal what-if overrides
  applyLayer(stepEnv, true);

  return env;
}

/**
 * Evaluates a schema field that's typed as `boolean | string` in the
 * workflow spec (e.g. `continue-on-error`, `strategy.fail-fast`). A whole
 * `${{ }}`-wrapped string evaluates to its raw (possibly non-string) value;
 * anything else is a literal compared case-insensitively to "true".
 */
export function evaluateBooleanField(
  raw: boolean | string | undefined,
  ctx: EvalContext
): boolean {
  if (raw === undefined) return false;
  if (typeof raw === "boolean") return raw;
  const trimmed = raw.trim();
  const spans = findExpressionSpans(trimmed);
  if (spans.length === 1 && spans[0].start === 0 && spans[0].end === trimmed.length) {
    try {
      return toBoolean(evaluateExpression(spans[0].expr.trim(), ctx));
    } catch {
      return false;
    }
  }
  return trimmed.toLowerCase() === "true";
}
