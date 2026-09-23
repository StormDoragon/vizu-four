// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepDetailPanel } from "./StepDetailPanel";
import { makeSessionView, makeStepRecord } from "./testSupport/sessionFixture";

describe("StepDetailPanel", () => {
  it("renders combinedOutput interleaved with per-stream styling", () => {
    const record = makeStepRecord({
      status: "success",
      conclusion: "success",
      combinedOutput: [
        { stream: "stdout", text: "starting up\n" },
        { stream: "stderr", text: "a warning\n" },
        { stream: "stdout", text: "done\n" },
      ],
    });
    const session = makeSessionView({
      lanes: {
        "build::default": {
          id: "build::default",
          jobId: "build",
          matrix: {},
          status: "success",
          pointer: 1,
          steps: [record],
          env: {},
          extraPath: [],
          outputs: {},
          tempDir: "/tmp/fixture",
        },
      },
      laneOrder: ["build::default"],
      activeLaneId: "build::default",
    });

    render(
      <StepDetailPanel
        session={session}
        selection={{ laneId: "build::default", stepIndex: 0 }}
        onSessionUpdate={vi.fn()}
      />
    );

    const log = screen.getByText("starting up").closest("pre")!;
    const spans = log.querySelectorAll("span");

    // Order preserved exactly as it arrived - not grouped by stream.
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toBe("starting up\n");
    expect(spans[1].textContent).toBe("a warning\n");
    expect(spans[2].textContent).toBe("done\n");

    // Only the stderr chunk gets the stream-specific styling.
    expect(spans[0].className).toBe("");
    expect(spans[1].className).toContain("text-red-300");
    expect(spans[2].className).toBe("");
  });

  it("shows a placeholder instead of a log when combinedOutput is empty", () => {
    const record = makeStepRecord({ status: "pending", combinedOutput: [] });
    const session = makeSessionView({
      lanes: {
        "build::default": {
          id: "build::default",
          jobId: "build",
          matrix: {},
          status: "ready",
          pointer: 0,
          steps: [record],
          env: {},
          extraPath: [],
          outputs: {},
          tempDir: "/tmp/fixture",
        },
      },
      laneOrder: ["build::default"],
      activeLaneId: "build::default",
    });

    render(
      <StepDetailPanel
        session={session}
        selection={{ laneId: "build::default", stepIndex: 0 }}
        onSessionUpdate={vi.fn()}
      />
    );

    expect(screen.getByText(/no output yet/i)).toBeInTheDocument();
  });

  it("shows a placeholder, not a crash, for a job with no steps", () => {
    // The parser keeps a job whose `steps:` is empty ("treated as an
    // immediate success"), and the debugger's initial selection for its
    // lane is step 0 - which doesn't exist. The panel read `step.name` off
    // it unconditionally and took the whole page down on load.
    const session = makeSessionView({
      workflow: {
        name: "CI",
        on: "push",
        jobs: { build: { id: "build", needs: [], matrix: null, steps: [] } },
      },
      lanes: {
        "build::default": {
          id: "build::default",
          jobId: "build",
          matrix: {},
          status: "success",
          jobResult: "success",
          pointer: 0,
          steps: [],
          env: {},
          extraPath: [],
          outputs: {},
          tempDir: "/tmp/fixture-tempdir",
        },
      },
    });

    render(
      <StepDetailPanel
        session={session}
        selection={{ laneId: "build::default", stepIndex: 0 }}
        onSessionUpdate={vi.fn()}
      />
    );
    expect(screen.getByText(/no steps/i)).toBeInTheDocument();
  });
});

