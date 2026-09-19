import { describe, expect, it } from "vitest";
import { focusedLaneLabel } from "./focusLane";
import { makeSessionView } from "./testSupport/sessionFixture";
import type { Lane } from "@/lib/engine/types";

function lane(overrides: Partial<Lane> = {}): Lane {
  return {
    id: "build::node-18",
    jobId: "build",
    matrix: { node: 18 },
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

describe("focusedLaneLabel", () => {
  it("combines the job name and combo label", () => {
    const l = lane();
    const session = makeSessionView({
      workflow: {
        name: "CI",
        on: "push",
        jobs: {
          build: { id: "build", name: "Build", needs: [], matrix: [{ node: 18 }], steps: [] },
        },
      },
      lanes: { [l.id]: l },
      laneOrder: [l.id],
    });
    expect(focusedLaneLabel(session, l.id)).toBe("Build — node=18");
  });

  it("falls back to the job id when the job has no display name", () => {
    const l = lane();
    const session = makeSessionView({
      workflow: {
        name: "CI",
        on: "push",
        jobs: { build: { id: "build", needs: [], matrix: [{ node: 18 }], steps: [] } },
      },
      lanes: { [l.id]: l },
      laneOrder: [l.id],
    });
    expect(focusedLaneLabel(session, l.id)).toBe("build — node=18");
  });

  it("returns null for an id that isn't a lane in this session", () => {
    const session = makeSessionView();
    expect(focusedLaneLabel(session, "nonexistent")).toBeNull();
  });
});
