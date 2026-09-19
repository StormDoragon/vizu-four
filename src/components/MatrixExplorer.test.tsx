// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MatrixExplorer } from "./MatrixExplorer";
import { makeSessionView } from "./testSupport/sessionFixture";
import type { Lane } from "@/lib/engine/types";

function laneFor(id: string, jobId: string, node: number): Lane {
  return {
    id,
    jobId,
    matrix: { node },
    status: "ready",
    pointer: 0,
    steps: [],
    env: {},
    extraPath: [],
    outputs: {},
    tempDir: "/tmp/fixture",
  };
}

describe("MatrixExplorer", () => {
  it("highlights the selected lane, with the steppable-lane marker on activeLaneId when they differ", () => {
    const laneA = laneFor("build::node-18", "build", 18);
    const laneB = laneFor("build::node-20", "build", 20);
    const session = makeSessionView({
      workflow: {
        name: "CI",
        on: "push",
        jobs: {
          build: {
            id: "build",
            needs: [],
            matrix: [{ node: 18 }, { node: 20 }],
            steps: [{ key: "step-0", run: "echo hi" }],
          },
        },
      },
      lanes: { [laneA.id]: laneA, [laneB.id]: laneB },
      laneOrder: [laneA.id, laneB.id],
      // The steppable lane (what Step/Continue act on) is A...
      activeLaneId: laneA.id,
    });

    // ...but the graph/detail panel are currently showing lane B, so this
    // tab must agree with what's on screen elsewhere rather than lane A.
    render(
      <MatrixExplorer
        session={session}
        selectedLaneId={laneB.id}
        onSelectLane={vi.fn()}
        focusedLaneId={null}
        onToggleFocus={vi.fn()}
      />
    );

    const buttons = screen.getAllByRole("button");
    const buttonA = buttons.find((b) => b.textContent?.includes("node=18"))!;
    const buttonB = buttons.find((b) => b.textContent?.includes("node=20"))!;

    // Selected lane (B) is visually highlighted.
    expect(buttonB.className).toContain("border-status-running");
    expect(buttonA.className).not.toContain("border-status-running");

    // Steppable-lane marker (●) appears on A, the active lane, and A alone
    // carries the "this is the steppable lane" title precisely because it
    // differs from the selected lane.
    expect(screen.getByLabelText("steppable lane")).toBeInTheDocument();
    expect(buttonA).toHaveAttribute("title", expect.stringContaining("steppable lane"));
    expect(buttonB).not.toHaveAttribute("title");
  });

  it("carries no steppable-lane title when the active and selected lane are the same", () => {
    const lane = laneFor("build::default", "build", 1);
    const session = makeSessionView({
      workflow: {
        name: "CI",
        on: "push",
        jobs: {
          build: {
            id: "build",
            needs: [],
            matrix: [{ node: 1 }],
            steps: [{ key: "step-0", run: "echo hi" }],
          },
        },
      },
      lanes: { [lane.id]: lane },
      laneOrder: [lane.id],
      activeLaneId: lane.id,
    });

    render(
      <MatrixExplorer
        session={session}
        selectedLaneId={lane.id}
        onSelectLane={vi.fn()}
        focusedLaneId={null}
        onToggleFocus={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: /node=1/ });
    expect(button).not.toHaveAttribute("title");
    // Still marked as the steppable lane, just without the disambiguating
    // tooltip, since there's nothing to disambiguate here.
    expect(screen.getByLabelText("steppable lane")).toBeInTheDocument();
  });

  it("shows a placeholder when no job in the workflow uses a matrix", () => {
    const session = makeSessionView();
    render(
      <MatrixExplorer
        session={session}
        selectedLaneId={null}
        onSelectLane={vi.fn()}
        focusedLaneId={null}
        onToggleFocus={vi.fn()}
      />
    );
    expect(screen.getByText(/no job in this workflow uses a build matrix/i)).toBeInTheDocument();
  });

  it("only shows the filter box once combinations exceed the threshold, and it filters by combo label", async () => {
    const user = userEvent.setup();
    const nodes = [14, 16, 18, 20, 22, 24, 26];
    const lanes = nodes.map((n) => laneFor(`build::node-${n}`, "build", n));
    const session = makeSessionView({
      workflow: {
        name: "CI",
        on: "push",
        jobs: {
          build: {
            id: "build",
            needs: [],
            matrix: nodes.map((n) => ({ node: n })),
            steps: [{ key: "step-0", run: "echo hi" }],
          },
        },
      },
      lanes: Object.fromEntries(lanes.map((l) => [l.id, l])),
      laneOrder: lanes.map((l) => l.id),
    });

    render(
      <MatrixExplorer
        session={session}
        selectedLaneId={null}
        onSelectLane={vi.fn()}
        focusedLaneId={null}
        onToggleFocus={vi.fn()}
      />
    );

    const filterInput = screen.getByTestId("matrix-filter");
    expect(screen.getByRole("button", { name: /node=14/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /node=26/ })).toBeInTheDocument();

    await user.type(filterInput, "24");

    expect(screen.getByRole("button", { name: /node=24/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /node=14/ })).not.toBeInTheDocument();
  });

  it("does not render a filter box for a small matrix", () => {
    const lane = laneFor("build::node-18", "build", 18);
    const session = makeSessionView({
      workflow: {
        name: "CI",
        on: "push",
        jobs: {
          build: { id: "build", needs: [], matrix: [{ node: 18 }], steps: [{ key: "step-0", run: "echo hi" }] },
        },
      },
      lanes: { [lane.id]: lane },
      laneOrder: [lane.id],
    });

    render(
      <MatrixExplorer
        session={session}
        selectedLaneId={null}
        onSelectLane={vi.fn()}
        focusedLaneId={null}
        onToggleFocus={vi.fn()}
      />
    );

    expect(screen.queryByTestId("matrix-filter")).not.toBeInTheDocument();
  });

  it("shows the focused-lane banner and de-emphasizes every other lane", () => {
    const laneA = laneFor("build::node-18", "build", 18);
    const laneB = laneFor("build::node-20", "build", 20);
    const session = makeSessionView({
      workflow: {
        name: "CI",
        on: "push",
        jobs: {
          build: {
            id: "build",
            name: "Build",
            needs: [],
            matrix: [{ node: 18 }, { node: 20 }],
            steps: [{ key: "step-0", run: "echo hi" }],
          },
        },
      },
      lanes: { [laneA.id]: laneA, [laneB.id]: laneB },
      laneOrder: [laneA.id, laneB.id],
    });

    render(
      <MatrixExplorer
        session={session}
        selectedLaneId={null}
        onSelectLane={vi.fn()}
        focusedLaneId={laneA.id}
        onToggleFocus={vi.fn()}
      />
    );

    expect(screen.getByText(/Build — node=18/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    const rowA = buttons.find((b) => b.textContent?.includes("node=18"))!.closest("div")!;
    const rowB = buttons.find((b) => b.textContent?.includes("node=20"))!.closest("div")!;
    expect(rowA.className).not.toContain("opacity-40");
    expect(rowB.className).toContain("opacity-40");
  });
});
