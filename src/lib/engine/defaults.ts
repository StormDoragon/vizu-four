import type { JsonValue, WorkflowFile } from "../workflow/types";
import type { RunConfig } from "./types";

function firstTriggerName(on: JsonValue): string {
  if (typeof on === "string") return on;
  if (Array.isArray(on)) return typeof on[0] === "string" ? on[0] : "workflow_dispatch";
  if (on !== null && typeof on === "object") {
    const keys = Object.keys(on);
    return keys[0] ?? "workflow_dispatch";
  }
  return "workflow_dispatch";
}

const SAMPLE_SHA = "1111111111111111111111111111111111111111";

function samplePayload(eventName: string): JsonValue {
  switch (eventName) {
    case "push":
      return {
        ref: "refs/heads/main",
        before: "0".repeat(40),
        after: SAMPLE_SHA,
        repository: { full_name: "local/workflow", default_branch: "main" },
        pusher: { name: "local-debugger" },
        head_commit: { id: SAMPLE_SHA, message: "Local debug run", author: { name: "local-debugger" } },
      };
    case "pull_request":
      return {
        action: "opened",
        number: 1,
        pull_request: {
          number: 1,
          title: "Sample pull request",
          head: { ref: "feature-branch", sha: SAMPLE_SHA },
          base: { ref: "main" },
          merged: false,
          draft: false,
        },
        repository: { full_name: "local/workflow", default_branch: "main" },
      };
    case "workflow_dispatch":
      return { inputs: {}, ref: "refs/heads/main", repository: { full_name: "local/workflow" } };
    case "schedule":
      return { schedule: "0 0 * * *" };
    default:
      return { repository: { full_name: "local/workflow" } };
  }
}

export function defaultRunConfig(workflow: WorkflowFile): RunConfig {
  const eventName = firstTriggerName(workflow.on);
  return {
    eventName,
    event: samplePayload(eventName),
    ref: "refs/heads/main",
    sha: SAMPLE_SHA,
    actor: "local-debugger",
    repository: "local/workflow",
    runId: "1",
    runNumber: "1",
    workflowInputs: {},
    vars: {},
    // GitHub always provides GITHUB_TOKEN implicitly, even if a workflow
    // never declares it - leaving it unseeded meant secrets.GITHUB_TOKEN
    // silently evaluated to null instead of a usable (masked) value. Still
    // overridable via What-If like any other secret.
    secrets: { GITHUB_TOKEN: "local-debug-github-token" },
    envOverrides: {},
  };
}
