// Domain model for a parsed GitHub Actions workflow. This is a pragmatic
// subset of the full workflow schema, covering what's needed to visualize
// and step-through a run: jobs, needs, strategy.matrix, steps (run/uses),
// env, if, and outputs.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface WorkflowStep {
  /** Stable key within the job: explicit `id`, else `step-<index>`. */
  key: string;
  id?: string;
  name?: string;
  if?: string;
  run?: string;
  shell?: string;
  uses?: string;
  with?: Record<string, JsonValue>;
  env?: Record<string, string>;
  "working-directory"?: string;
  "continue-on-error"?: boolean | string;
  "timeout-minutes"?: number;
  index: number;
}

export interface MatrixDefinition {
  /** Axis name -> list of possible values. Excludes `include`/`exclude`. */
  axes: Record<string, JsonValue[]>;
  include?: Record<string, JsonValue>[];
  exclude?: Record<string, JsonValue>[];
}

export interface WorkflowJob {
  id: string;
  name?: string;
  needs: string[];
  "runs-on": JsonValue;
  if?: string;
  env?: Record<string, string>;
  strategy?: {
    matrix?: MatrixDefinition;
    "fail-fast"?: boolean;
    "max-parallel"?: number;
  };
  outputs?: Record<string, string>;
  steps: WorkflowStep[];
}

export interface WorkflowFile {
  name?: string;
  on: JsonValue;
  env?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
  /** Raw source, kept for display / hashing. */
  raw: string;
  /** Path or filename the workflow was loaded from, if any. */
  sourcePath?: string;
}

export interface ParseIssue {
  severity: "error" | "warning";
  message: string;
  path?: string;
}

export interface ParseResult {
  workflow: WorkflowFile | null;
  issues: ParseIssue[];
}
