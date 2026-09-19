import type { JsonValue } from "./workflow/types";
import type { SessionView } from "./engine/serialize";
import type { StepMock } from "./engine/types";
import type { WhatIfPatch } from "./engine/session";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error ?? `Request failed with status ${res.status}`, res.status, body);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ParseIssue {
  severity: "error" | "warning";
  message: string;
  path?: string;
}

export interface ExampleWorkflow {
  name: string;
  content: string;
}

export async function listExamples(): Promise<ExampleWorkflow[]> {
  const data = await request<{ examples: ExampleWorkflow[] }>("/api/examples");
  return data.examples;
}

export interface DeploymentConfig {
  simulationOnly: boolean;
}

export async function getDeploymentConfig(): Promise<DeploymentConfig> {
  return request("/api/config");
}

export interface WorkspaceWorkflowFile {
  relativePath: string;
  name: string;
  content: string;
}

/** Lists `.github/workflows/*.yml` under a directory on the host running
 * the debugger, for the "open a workflow from the repo" flow. Throws (via
 * ApiError, status 403) if this deployment has real-workspace access
 * disabled. */
export async function listWorkspaceWorkflows(directory: string): Promise<WorkspaceWorkflowFile[]> {
  const data = await request<{ files: WorkspaceWorkflowFile[] }>("/api/workspace/workflows", {
    method: "POST",
    body: JSON.stringify({ directory }),
  });
  return data.files;
}

export async function createSession(
  workflowYaml: string,
  options?: { sourcePath?: string; workingTreeDir?: string }
): Promise<{ session: SessionView; issues: ParseIssue[] }> {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      workflowYaml,
      sourcePath: options?.sourcePath,
      workingTreeDir: options?.workingTreeDir,
    }),
  });
}

export async function getSession(id: string): Promise<{ session: SessionView }> {
  return request(`/api/sessions/${id}`);
}

export async function deleteSession(id: string): Promise<void> {
  await request(`/api/sessions/${id}`, { method: "DELETE" });
}

export type ControlAction = "step" | "continue" | "runToEnd" | "runAll";

export async function control(
  id: string,
  action: ControlAction,
  laneId?: string
): Promise<{ session: SessionView }> {
  return request(`/api/sessions/${id}/control`, {
    method: "POST",
    body: JSON.stringify({ action, laneId }),
  });
}

export async function setBreakpoint(
  id: string,
  jobId: string,
  stepKey: string,
  enabled: boolean
): Promise<{ session: SessionView }> {
  return request(`/api/sessions/${id}/breakpoints`, {
    method: "POST",
    body: JSON.stringify({ jobId, stepKey, enabled }),
  });
}

export async function setMockOutputs(
  id: string,
  jobId: string,
  stepKey: string,
  mock: StepMock | null
): Promise<{ session: SessionView }> {
  return request(`/api/sessions/${id}/mock-outputs`, {
    method: "POST",
    body: JSON.stringify({ jobId, stepKey, mock }),
  });
}

export async function applyWhatIf(id: string, patch: WhatIfPatch): Promise<{ session: SessionView }> {
  return request(`/api/sessions/${id}/whatif`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export async function setActiveLane(id: string, laneId: string): Promise<{ session: SessionView }> {
  return request(`/api/sessions/${id}/active-lane`, {
    method: "POST",
    body: JSON.stringify({ laneId }),
  });
}

export interface FailureCause {
  title: string;
  detail: string;
  confidence: "high" | "medium" | "low";
  suggestion?: string;
}
export interface FailureExplanation {
  summary: string;
  causes: FailureCause[];
  source: "heuristic" | "claude";
}

export async function explainFailure(
  id: string,
  laneId: string,
  stepIndex: number
): Promise<{ explanation: FailureExplanation }> {
  return request(`/api/sessions/${id}/explain`, {
    method: "POST",
    body: JSON.stringify({ laneId, stepIndex }),
  });
}

export async function evaluateExpression(
  expression: string,
  sessionId?: string,
  laneId?: string
): Promise<{ result?: JsonValue; error?: string }> {
  return request("/api/expressions/evaluate", {
    method: "POST",
    body: JSON.stringify({ expression, sessionId, laneId }),
  });
}

export async function getContext(
  id: string,
  laneId: string,
  stepIndex?: number
): Promise<{ context: Record<string, JsonValue>; pointer: number }> {
  const stepParam = stepIndex !== undefined ? `&stepIndex=${stepIndex}` : "";
  return request(`/api/sessions/${id}/context?laneId=${encodeURIComponent(laneId)}${stepParam}`);
}
