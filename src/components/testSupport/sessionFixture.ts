import type { SessionView, SessionViewJob } from "@/lib/engine/serialize";
import type { Lane, StepRunRecord } from "@/lib/engine/types";

/**
 * Builds a minimal-but-valid StepRunRecord, overridable per test. Shared
 * across component tests instead of each one hand-rolling every required
 * field of a fairly large type.
 */
export function makeStepRecord(overrides: Partial<StepRunRecord> = {}): StepRunRecord {
  return {
    key: "step-0",
    name: "a step",
    status: "pending",
    continueOnError: false,
    outputs: {},
    stdout: "",
    stderr: "",
    combinedOutput: [],
    ...overrides,
  };
}

function makeLane(overrides: Partial<Lane> = {}): Lane {
  return {
    id: "build::default",
    jobId: "build",
    matrix: {},
    status: "ready",
    pointer: 0,
    steps: [makeStepRecord()],
    env: {},
    extraPath: [],
    outputs: {},
    tempDir: "/tmp/fixture-tempdir",
    ...overrides,
  };
}

function makeJob(overrides: Partial<SessionViewJob> = {}): SessionViewJob {
  return {
    id: "build",
    needs: [],
    matrix: null,
    steps: [{ key: "step-0", run: "echo hi" }],
    ...overrides,
  };
}

/**
 * Builds a minimal-but-valid SessionView for component tests. Defaults to a
 * single job with a single lane and a single pending step; pass `lanes` /
 * `jobs` overrides for anything more specific to a test.
 */
export function makeSessionView(overrides: Partial<SessionView> = {}): SessionView {
  const lane = makeLane();
  return {
    id: "session-1",
    createdAt: new Date(0).toISOString(),
    workflow: {
      name: "CI",
      on: "push",
      jobs: { build: makeJob() },
    },
    graph: { levels: [["build"]], cycles: [] },
    config: {
      eventName: "push",
      event: {},
      ref: "refs/heads/main",
      sha: "0".repeat(40),
      actor: "octocat",
      repository: "octocat/hello-world",
      runId: "1",
      runNumber: "1",
      workflowInputs: {},
      vars: {},
      secretNames: [],
      envOverrides: {},
    },
    breakpoints: [],
    breakOnFailure: true,
    activeLaneId: lane.id,
    lanes: { [lane.id]: lane },
    laneOrder: [lane.id],
    mockOutputs: {},
    revision: 0,
    parseIssues: [],
    workflowHash: "fixture-hash",
    simulationOnly: false,
    usesRealWorkspace: false,
    awaitingExecutionConsent: false,
    ...overrides,
  };
}
