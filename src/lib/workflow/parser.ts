import yaml from "js-yaml";
import type {
  JsonValue,
  MatrixDefinition,
  ParseIssue,
  ParseResult,
  WorkflowFile,
  WorkflowJob,
  WorkflowStep,
} from "./types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

/**
 * `if:` is commonly written without `${{ }}` (e.g. `if: false`, `if: 0`),
 * which YAML parses as a boolean/number rather than a string. GitHub still
 * evaluates these as expressions, so we stringify them instead of only
 * accepting string values - otherwise `if: false` was silently dropped
 * (treated as "no condition", i.e. always true).
 */
function asIfExpr(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return undefined;
}

/**
 * YAML 1.1 parsers historically coerce bare `on`/`off`/`yes`/`no` keys to
 * booleans, which famously breaks GitHub Actions' `on:` trigger key. js-yaml
 * 4's default schema does not do this for `on`, but we normalize defensively
 * in case a workflow was hand-rolled with unusual YAML anchors/tags.
 */
function normalizeTopLevelKeys(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "true" || k === "True") out["on"] = v;
    else out[k] = v;
  }
  return out;
}

function parseMatrix(
  raw: unknown,
  jobId: string,
  issues: ParseIssue[]
): MatrixDefinition | undefined {
  if (!isPlainObject(raw)) return undefined;
  const axes: Record<string, JsonValue[]> = {};
  let include: Record<string, JsonValue>[] | undefined;
  let exclude: Record<string, JsonValue>[] | undefined;

  for (const [key, value] of Object.entries(raw)) {
    if (key === "include") {
      if (Array.isArray(value)) {
        include = value.filter(isPlainObject) as Record<string, JsonValue>[];
      } else {
        issues.push({
          severity: "warning",
          message: `jobs.${jobId}.strategy.matrix.include must be a list; ignoring`,
        });
      }
      continue;
    }
    if (key === "exclude") {
      if (Array.isArray(value)) {
        exclude = value.filter(isPlainObject) as Record<string, JsonValue>[];
      } else {
        issues.push({
          severity: "warning",
          message: `jobs.${jobId}.strategy.matrix.exclude must be a list; ignoring`,
        });
      }
      continue;
    }
    if (Array.isArray(value)) {
      axes[key] = value as JsonValue[];
    } else {
      issues.push({
        severity: "warning",
        message: `jobs.${jobId}.strategy.matrix.${key} must be a list; ignoring axis`,
      });
    }
  }

  return { axes, include, exclude };
}

function parseStep(
  raw: unknown,
  index: number,
  jobId: string,
  issues: ParseIssue[]
): WorkflowStep | null {
  if (!isPlainObject(raw)) {
    issues.push({
      severity: "error",
      message: `jobs.${jobId}.steps[${index}] is not a mapping`,
    });
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id : undefined;
  const key = id ?? `step-${index}`;
  const step: WorkflowStep = {
    key,
    id,
    name: typeof raw.name === "string" ? raw.name : undefined,
    if: asIfExpr(raw.if),
    run: typeof raw.run === "string" ? raw.run : undefined,
    shell: typeof raw.shell === "string" ? raw.shell : undefined,
    uses: typeof raw.uses === "string" ? raw.uses : undefined,
    with: isPlainObject(raw.with)
      ? (raw.with as Record<string, JsonValue>)
      : undefined,
    env: isPlainObject(raw.env)
      ? Object.fromEntries(
          Object.entries(raw.env).map(([k, v]) => [k, String(v)])
        )
      : undefined,
    "working-directory":
      typeof raw["working-directory"] === "string"
        ? (raw["working-directory"] as string)
        : undefined,
    "continue-on-error": raw["continue-on-error"] as
      | boolean
      | string
      | undefined,
    "timeout-minutes": raw["timeout-minutes"] as number | undefined,
    index,
  };
  if (!step.run && !step.uses) {
    issues.push({
      severity: "warning",
      message: `jobs.${jobId}.steps[${index}] has neither 'run' nor 'uses'`,
    });
  }
  return step;
}

function parseJob(
  raw: unknown,
  jobId: string,
  issues: ParseIssue[]
): WorkflowJob | null {
  if (!isPlainObject(raw)) {
    issues.push({ severity: "error", message: `jobs.${jobId} is not a mapping` });
    return null;
  }
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  if (!Array.isArray(raw.steps)) {
    issues.push({
      severity: "warning",
      message: `jobs.${jobId}.steps is missing or not a list; treating as empty`,
    });
  } else if (stepsRaw.length === 0) {
    issues.push({
      severity: "warning",
      message: `jobs.${jobId}.steps is empty; this job will be treated as an immediate success`,
    });
  }
  const steps: WorkflowStep[] = [];
  stepsRaw.forEach((s, i) => {
    const step = parseStep(s, i, jobId, issues);
    if (step) steps.push(step);
  });

  const strategyRaw = isPlainObject(raw.strategy) ? raw.strategy : undefined;

  return {
    id: jobId,
    name: typeof raw.name === "string" ? raw.name : undefined,
    needs: asStringArray(raw.needs),
    "runs-on": (raw["runs-on"] as JsonValue) ?? "ubuntu-latest",
    if: asIfExpr(raw.if),
    env: isPlainObject(raw.env)
      ? Object.fromEntries(
          Object.entries(raw.env).map(([k, v]) => [k, String(v)])
        )
      : undefined,
    strategy: strategyRaw
      ? {
          matrix: parseMatrix(strategyRaw.matrix, jobId, issues),
          "fail-fast":
            typeof strategyRaw["fail-fast"] === "boolean"
              ? strategyRaw["fail-fast"]
              : undefined,
          "max-parallel":
            typeof strategyRaw["max-parallel"] === "number"
              ? strategyRaw["max-parallel"]
              : undefined,
        }
      : undefined,
    outputs: isPlainObject(raw.outputs)
      ? Object.fromEntries(
          Object.entries(raw.outputs).map(([k, v]) => [k, String(v)])
        )
      : undefined,
    steps,
  };
}

export function parseWorkflow(source: string, sourcePath?: string): ParseResult {
  const issues: ParseIssue[] = [];
  let doc: unknown;
  try {
    doc = yaml.load(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      workflow: null,
      issues: [{ severity: "error", message: `YAML parse error: ${message}` }],
    };
  }

  if (!isPlainObject(doc)) {
    return {
      workflow: null,
      issues: [{ severity: "error", message: "Workflow file is not a YAML mapping" }],
    };
  }

  const normalized = normalizeTopLevelKeys(doc);

  if (!isPlainObject(normalized.jobs)) {
    return {
      workflow: null,
      issues: [{ severity: "error", message: "Workflow has no 'jobs' mapping" }],
    };
  }

  const jobs: Record<string, WorkflowJob> = {};
  for (const [jobId, rawJob] of Object.entries(normalized.jobs)) {
    const job = parseJob(rawJob, jobId, issues);
    if (job) jobs[jobId] = job;
  }

  if (Object.keys(jobs).length === 0) {
    issues.push({ severity: "error", message: "Workflow defines zero valid jobs" });
  }

  // Validate `needs` reference real jobs.
  for (const job of Object.values(jobs)) {
    for (const dep of job.needs) {
      if (!jobs[dep]) {
        issues.push({
          severity: "error",
          message: `jobs.${job.id}.needs references unknown job '${dep}'`,
        });
      }
    }
  }

  const workflow: WorkflowFile = {
    name: typeof normalized.name === "string" ? normalized.name : undefined,
    on: (normalized.on as JsonValue) ?? null,
    env: isPlainObject(normalized.env)
      ? Object.fromEntries(
          Object.entries(normalized.env).map(([k, v]) => [k, String(v)])
        )
      : undefined,
    jobs,
    raw: source,
    sourcePath,
  };

  const hasBlockingError = issues.some((i) => i.severity === "error");
  return { workflow: hasBlockingError && Object.keys(jobs).length === 0 ? null : workflow, issues };
}
