import type { JsonValue } from "./workflow/types";
import type { SessionView } from "./engine/serialize";
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
  /** Friendly label for the home-page picker (falls back to filename). */
  label?: string;
  content: string;
}

export async function listExamples(): Promise<ExampleWorkflow[]> {
  const data = await request<{ examples: ExampleWorkflow[] }>("/api/examples");
  return data.examples;
}

export async function createSession(
  workflowYaml: string,
  sourcePath?: string
): Promise<{ session: SessionView; issues: ParseIssue[] }> {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ workflowYaml, sourcePath }),
  });
}

export async function getSession(id: string): Promise<SessionView> {
  return request(`/api/sessions/${id}`);
}

export async function control(
  id: string,
  action: "step" | "continue" | "runToEnd" | "runAll",
  laneId?: string
): Promise<SessionView> {
  return request(`/api/sessions/${id}/control`, {
    method: "POST",
    body: JSON.stringify({ action, laneId }),
  });
}

export async function setBreakpoints(
  id: string,
  breakpoints: { jobId: string; stepKey: string; enabled: boolean }[]
): Promise<SessionView> {
  return request(`/api/sessions/${id}/breakpoints`, {
    method: "POST",
    body: JSON.stringify({ breakpoints }),
  });
}

export async function setActiveLane(id: string, laneId: string): Promise<SessionView> {
  return request(`/api/sessions/${id}/active-lane`, {
    method: "POST",
    body: JSON.stringify({ laneId }),
  });
}

export async function applyWhatIf(id: string, patch: WhatIfPatch): Promise<SessionView> {
  return request(`/api/sessions/${id}/whatif`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export async function getContext(id: string, laneId?: string): Promise<unknown> {
  const q = laneId ? `?laneId=${encodeURIComponent(laneId)}` : "";
  return request(`/api/sessions/${id}/context${q}`);
}

export async function explain(id: string, laneId: string, stepKey: string): Promise<unknown> {
  return request(`/api/sessions/${id}/explain`, {
    method: "POST",
    body: JSON.stringify({ laneId, stepKey }),
  });
}

export async function evaluateExpression(
  id: string,
  expression: string,
  laneId?: string
): Promise<{ result: JsonValue; error?: string }> {
  return request("/api/expressions/evaluate", {
    method: "POST",
    body: JSON.stringify({ sessionId: id, expression, laneId }),
  });
}
