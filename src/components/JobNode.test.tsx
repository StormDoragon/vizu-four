// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import { JobNode } from "./JobNode";
import { makeSessionView, makeStepRecord } from "./testSupport/sessionFixture";
import type { Lane } from "@/lib/engine/types";
import type { JobNodeData } from "./types";

function lane(overrides: Partial<Lane> = {}): Lane {
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
    tempDir: "/tmp/fixture",
    ...overrides,
  };
}

function renderJobNode(data: Partial<JobNodeData> & { jobId: string; laneId: string }) {
  const full: JobNodeData = {
    session: makeSessionView(),
    lanesForJob: [],
    isActiveLaneJob: false,
    selection: null,
    busy: false,
    focusedLaneId: null,
    onSelectStep: vi.fn(),
    onToggleBreakpoint: vi.fn(),
    onSelectLane: vi.fn(),
    onToggleFocus: vi.fn(),
    ...data,
  };
  return render(
    <ReactFlowProvider>
      <JobNode
        id="build"
        type="job"
        data={full}
        selected={false}
        isConnectable
        zIndex={0}
        dragging={false}
        draggable={false}
        selectable={false}
        deletable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    </ReactFlowProvider>
  );
}

describe("JobNode", () => {
  it("renders a hollow ring for a pending step, not a filled dot", () => {
    const l = lane({ pointer: 0, status: "ready", steps: [makeStepRecord({ status: "pending" })] });
    const session = makeSessionView({ lanes: { [l.id]: l }, laneOrder: [l.id], activeLaneId: l.id });
    renderJobNode({ session, jobId: "build", laneId: l.id });
    // The step row's dot uses the pending style (title="pending"); the lane
    // header's status dot also reads "ready" -> pending style.
    const dots = screen.getAllByTitle("pending");
    expect(dots.length).toBeGreaterThan(0);
    expect(dots[0].className).toContain("border-2");
  });

  it("animates the live step with a spinning ring while a control request is in flight", () => {
    const l = lane({
      pointer: 0,
      status: "ready",
      steps: [makeStepRecord({ status: "pending" }), makeStepRecord({ status: "pending" })],
    });
    const session = makeSessionView({
      lanes: { [l.id]: l },
      laneOrder: [l.id],
      activeLaneId: l.id,
      workflow: {
        name: "w",
        on: "push",
        jobs: {
          build: {
            id: "build",
            needs: [],
            matrix: null,
            steps: [
              { key: "step-0", name: "Step A" },
              { key: "step-1", name: "Step B" },
            ],
          },
        },
      },
    });
    renderJobNode({ session, jobId: "build", laneId: l.id, busy: true });
    const running = screen.getAllByTitle("running");
    // Both the lane-header dot and the pointer step's dot should animate.
    expect(running.length).toBe(2);
    for (const dot of running) expect(dot.className).toContain("animate-spin");
  });

  it("does not animate a step that isn't the lane's current pointer, even while busy", () => {
    const l = lane({
      pointer: 0,
      status: "ready",
      steps: [makeStepRecord({ status: "pending" }), makeStepRecord({ status: "pending" })],
    });
    const session = makeSessionView({
      lanes: { [l.id]: l },
      laneOrder: [l.id],
      activeLaneId: l.id,
      workflow: {
        name: "w",
        on: "push",
        jobs: {
          build: {
            id: "build",
            needs: [],
            matrix: null,
            steps: [
              { key: "step-0", name: "Step A" },
              { key: "step-1", name: "Step B" },
            ],
          },
        },
      },
    });
    renderJobNode({ session, jobId: "build", laneId: l.id, busy: true });
    // Only the lane header + step 0 (the pointer) animate - step 1 must not.
    expect(screen.getAllByTitle("running")).toHaveLength(2);
    const pendingDots = screen.getAllByTitle("pending");
    for (const dot of pendingDots) expect(dot.className).not.toContain("animate-spin");
  });

  it("shows a redundant, non-color glyph next to a finished step, not just a colored dot", () => {
    const l = lane({
      pointer: 1,
      status: "paused",
      steps: [makeStepRecord({ status: "success", conclusion: "success" })],
    });
    const session = makeSessionView({
      lanes: { [l.id]: l },
      laneOrder: [l.id],
      activeLaneId: l.id,
      workflow: {
        name: "w",
        on: "push",
        jobs: { build: { id: "build", needs: [], matrix: null, steps: [{ key: "step-0", name: "A" }] } },
      },
    });
    renderJobNode({ session, jobId: "build", laneId: l.id });
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("marks the node as focused and reports the toggle when 🎯 is clicked", async () => {
    const user = userEvent.setup();
    const laneA = lane({ id: "build::node-18", matrix: { node: 18 } });
    const laneB = lane({ id: "build::node-20", matrix: { node: 20 } });
    const session = makeSessionView({
      lanes: { [laneA.id]: laneA, [laneB.id]: laneB },
      laneOrder: [laneA.id, laneB.id],
      workflow: {
        name: "w",
        on: "push",
        jobs: { build: { id: "build", needs: [], matrix: [{ node: 18 }, { node: 20 }], steps: [] } },
      },
    });
    const onToggleFocus = vi.fn();
    renderJobNode({
      session,
      jobId: "build",
      laneId: laneA.id,
      lanesForJob: [laneA, laneB],
      onToggleFocus,
    });

    expect(screen.queryByText("focused")).not.toBeInTheDocument();
    await user.click(screen.getByTitle("Debug this combination only"));
    expect(onToggleFocus).toHaveBeenCalledWith(laneA.id);
  });

  it("shows the focused badge when this node's displayed lane is the focused one", () => {
    const l = lane();
    const session = makeSessionView({ lanes: { [l.id]: l }, laneOrder: [l.id] });
    renderJobNode({ session, jobId: "build", laneId: l.id, focusedLaneId: l.id });
    expect(screen.getByText("focused")).toBeInTheDocument();
  });

  it("shows a filter box only once a job has enough combinations to need one", () => {
    const manyLanes = Array.from({ length: 9 }, (_, i) =>
      lane({ id: `build::node-${i}`, matrix: { node: i } })
    );
    const session = makeSessionView({
      lanes: Object.fromEntries(manyLanes.map((l) => [l.id, l])),
      laneOrder: manyLanes.map((l) => l.id),
      workflow: {
        name: "w",
        on: "push",
        jobs: {
          build: {
            id: "build",
            needs: [],
            matrix: manyLanes.map((l) => l.matrix),
            steps: [],
          },
        },
      },
    });
    renderJobNode({ session, jobId: "build", laneId: manyLanes[0].id, lanesForJob: manyLanes });
    expect(screen.getByTestId("lane-filter")).toBeInTheDocument();
  });

  it("does not show a filter box for a small matrix", () => {
    const laneA = lane({ id: "build::node-18", matrix: { node: 18 } });
    const laneB = lane({ id: "build::node-20", matrix: { node: 20 } });
    const session = makeSessionView({
      lanes: { [laneA.id]: laneA, [laneB.id]: laneB },
      laneOrder: [laneA.id, laneB.id],
      workflow: {
        name: "w",
        on: "push",
        jobs: { build: { id: "build", needs: [], matrix: [{ node: 18 }, { node: 20 }], steps: [] } },
      },
    });
    renderJobNode({ session, jobId: "build", laneId: laneA.id, lanesForJob: [laneA, laneB] });
    expect(screen.queryByTestId("lane-filter")).not.toBeInTheDocument();
  });
});
