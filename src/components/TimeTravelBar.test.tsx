// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TimeTravelBar } from "./TimeTravelBar";
import { makeSessionView, makeStepRecord } from "./testSupport/sessionFixture";
import type { Lane } from "@/lib/engine/types";

function laneWithSteps(overrides: Partial<Lane> = {}): Lane {
  return {
    id: "build::default",
    jobId: "build",
    matrix: {},
    status: "paused",
    pointer: 2,
    steps: [makeStepRecord(), makeStepRecord(), makeStepRecord()],
    env: {},
    extraPath: [],
    outputs: {},
    tempDir: "/tmp/fixture",
    ...overrides,
  };
}

function sessionWithLane(lane: Lane) {
  return makeSessionView({
    workflow: {
      name: "CI",
      on: "push",
      jobs: {
        build: {
          id: "build",
          needs: [],
          matrix: null,
          steps: [
            { key: "step-0", name: "Checkout" },
            { key: "step-1", name: "Build" },
            { key: "step-2", name: "Test" },
          ],
        },
      },
    },
    lanes: { [lane.id]: lane },
    laneOrder: [lane.id],
    activeLaneId: lane.id,
  });
}

describe("TimeTravelBar", () => {
  it("shows the live badge and no jump-to-live button when selection is the live cursor", () => {
    const lane = laneWithSteps({ pointer: 2 });
    const session = sessionWithLane(lane);
    render(
      <TimeTravelBar session={session} selection={{ laneId: lane.id, stepIndex: 2 }} onSelect={vi.fn()} />
    );

    expect(screen.getByTestId("time-travel-badge")).toHaveTextContent("live");
    expect(screen.getByText(/step 3 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/Test/)).toBeInTheDocument();
    expect(screen.queryByTestId("jump-to-live")).not.toBeInTheDocument();
  });

  it("shows the history badge and a working jump-to-live button for an earlier step", async () => {
    const user = userEvent.setup();
    const lane = laneWithSteps({ pointer: 2 });
    const session = sessionWithLane(lane);
    const onSelect = vi.fn();
    render(
      <TimeTravelBar session={session} selection={{ laneId: lane.id, stepIndex: 0 }} onSelect={onSelect} />
    );

    expect(screen.getByTestId("time-travel-badge")).toHaveTextContent("history");
    expect(screen.getByText(/step 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/Checkout/)).toBeInTheDocument();

    await user.click(screen.getByTestId("jump-to-live"));
    expect(onSelect).toHaveBeenCalledWith({ laneId: lane.id, stepIndex: 2 });
  });

  it("disables Previous at the first step and Next at the live cursor, without going past either", async () => {
    const user = userEvent.setup();
    const lane = laneWithSteps({ pointer: 1 });
    const session = sessionWithLane(lane);
    const onSelect = vi.fn();
    render(
      <TimeTravelBar session={session} selection={{ laneId: lane.id, stepIndex: 0 }} onSelect={onSelect} />
    );

    expect(screen.getByLabelText("Previous step")).toBeDisabled();
    expect(screen.getByLabelText("Next step")).not.toBeDisabled();

    await user.click(screen.getByLabelText("Next step"));
    expect(onSelect).toHaveBeenCalledWith({ laneId: lane.id, stepIndex: 1 });
  });

  it("disables Next once at the live cursor, even mid-run with unrun steps after it", () => {
    const lane = laneWithSteps({ pointer: 1 }); // step 2 (index 2) hasn't run yet
    const session = sessionWithLane(lane);
    render(
      <TimeTravelBar session={session} selection={{ laneId: lane.id, stepIndex: 1 }} onSelect={vi.fn()} />
    );
    expect(screen.getByLabelText("Next step")).toBeDisabled();
  });

  it("renders nothing for a lane with no steps", () => {
    const lane = laneWithSteps({ steps: [], pointer: 0 });
    const session = sessionWithLane(lane);
    const { container } = render(
      <TimeTravelBar session={session} selection={null} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
