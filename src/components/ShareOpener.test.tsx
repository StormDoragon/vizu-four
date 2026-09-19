// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareOpener } from "./ShareOpener";
import * as apiClient from "@/lib/apiClient";
import { encodeSharePayload, type SharePayload } from "@/lib/share";
import { makeSessionView } from "./testSupport/sessionFixture";
import type { Lane } from "@/lib/engine/types";
import type { SessionView } from "@/lib/engine/serialize";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  replace.mockClear();
});

function payload(overrides: Partial<SharePayload> = {}): SharePayload {
  return {
    version: 1,
    yaml: "name: CI\non: push\njobs: {}",
    breakpoints: [],
    env: {},
    vars: {},
    breakOnFailure: true,
    mockOutputs: {},
    progress: [],
    activeLane: null,
    ...overrides,
  };
}

function lane(overrides: Partial<Lane> = {}): Lane {
  return {
    id: "build::default",
    jobId: "build",
    matrix: {},
    status: "ready",
    pointer: 0,
    steps: [],
    env: {},
    extraPath: [],
    outputs: {},
    tempDir: "/tmp/fixture",
    ...overrides,
  };
}

describe("ShareOpener", () => {
  it("shows an error for an invalid token", async () => {
    render(<ShareOpener token="not-a-valid-token" />);
    expect(await screen.findByText(/invalid or corrupted/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("creates a session, applies breakpoints/whatif/mocks, replays progress, and redirects", async () => {
    const l = lane({ id: "build::default", jobId: "build", pointer: 0, steps: [] });
    const created = makeSessionView({ id: "new-session", lanes: { [l.id]: l }, laneOrder: [l.id], activeLaneId: null });

    vi.spyOn(apiClient, "createSession").mockResolvedValue({ session: created, issues: [] });
    const applyWhatIf = vi.spyOn(apiClient, "applyWhatIf").mockResolvedValue({ session: created });
    const setBreakpoint = vi.spyOn(apiClient, "setBreakpoint").mockResolvedValue({ session: created });
    const setMockOutputs = vi.spyOn(apiClient, "setMockOutputs").mockResolvedValue({ session: created });
    const controlSpy = vi.spyOn(apiClient, "control").mockResolvedValue({
      session: { ...created, lanes: { [l.id]: { ...l, pointer: 1 } } },
    });
    const setActiveLane = vi.spyOn(apiClient, "setActiveLane").mockResolvedValue({
      session: { ...created, activeLaneId: l.id },
    });

    const token = encodeSharePayload(
      payload({
        breakpoints: ["build:step-0"],
        env: { FOO: "bar" },
        mockOutputs: { "build:step-0": { outputs: { result: "ok" } } },
        progress: [{ jobId: "build", matrix: {}, stepIndex: 1 }],
        activeLane: { jobId: "build", matrix: {} },
      })
    );

    render(<ShareOpener token={token} />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/debug/new-session?shared=1"));

    expect(applyWhatIf).toHaveBeenCalledWith("new-session", { env: { FOO: "bar" }, vars: {}, breakOnFailure: true });
    expect(setBreakpoint).toHaveBeenCalledWith("new-session", "build", "step-0", true);
    expect(setMockOutputs).toHaveBeenCalledWith("new-session", "build", "step-0", { outputs: { result: "ok" } });
    expect(controlSpy).toHaveBeenCalledWith("new-session", "step", "build::default");
    expect(setActiveLane).toHaveBeenCalledWith("new-session", "build::default");
  });

  it("skips a blocked lane and retries it once its dependency reaches a terminal status", async () => {
    const setupLane = lane({ id: "setup::default", jobId: "setup", status: "ready", pointer: 0 });
    const buildLane = lane({ id: "build::default", jobId: "build", status: "blocked", pointer: 0 });
    const created = makeSessionView({
      id: "new-session",
      lanes: { [setupLane.id]: setupLane, [buildLane.id]: buildLane },
      laneOrder: [setupLane.id, buildLane.id],
      activeLaneId: null,
      workflow: {
        name: "CI",
        on: "push",
        jobs: {
          setup: { id: "setup", needs: [], matrix: null, steps: [] },
          build: { id: "build", needs: ["setup"], matrix: null, steps: [] },
        },
      },
    });

    vi.spyOn(apiClient, "createSession").mockResolvedValue({ session: created, issues: [] });

    // Local mutable state standing in for the server: stepping "setup" once
    // finishes it and unblocks "build" - matching what recomputeLaneReadiness
    // actually does after a lane reaches a terminal status.
    let current: SessionView = created;
    const controlSpy = vi.spyOn(apiClient, "control").mockImplementation(async (_id, _action, laneId) => {
      if (laneId === "setup::default") {
        current = {
          ...current,
          lanes: {
            ...current.lanes,
            "setup::default": { ...current.lanes["setup::default"], pointer: 1, status: "success" },
            "build::default": { ...current.lanes["build::default"], status: "ready" },
          },
        };
      } else if (laneId === "build::default") {
        current = {
          ...current,
          lanes: { ...current.lanes, "build::default": { ...current.lanes["build::default"], pointer: 1, status: "success" } },
        };
      }
      return { session: current };
    });

    const token = encodeSharePayload(
      payload({
        progress: [
          { jobId: "setup", matrix: {}, stepIndex: 1 },
          { jobId: "build", matrix: {}, stepIndex: 1 },
        ],
      })
    );

    render(<ShareOpener token={token} />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/debug/new-session?shared=1"));

    // "build" must not be stepped before "setup" has actually finished.
    const laneOrder = controlSpy.mock.calls.map((c) => c[2]);
    expect(laneOrder.indexOf("setup::default")).toBeLessThan(laneOrder.indexOf("build::default"));
  });

  it("shows an error when session creation fails", async () => {
    vi.spyOn(apiClient, "createSession").mockRejectedValue(new Error("Workflow failed to parse"));

    render(<ShareOpener token={encodeSharePayload(payload())} />);

    expect(await screen.findByText(/Workflow failed to parse/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
