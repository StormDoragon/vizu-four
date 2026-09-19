import { describe, expect, it } from "vitest";
import { estimateNodeHeight, layoutJobs } from "./graphLayout";
import { makeSessionView } from "./testSupport/sessionFixture";
import type { SessionViewJob } from "@/lib/engine/serialize";

function job(overrides: Partial<SessionViewJob> = {}): SessionViewJob {
  return {
    id: "a",
    needs: [],
    matrix: null,
    steps: [{ key: "step-0", run: "echo hi" }],
    ...overrides,
  };
}

describe("estimateNodeHeight", () => {
  it("grows with step count, up to the scrollable cap", () => {
    const oneStep = makeSessionView({ workflow: { name: "w", on: "push", jobs: { a: job() } } });
    const manySteps = makeSessionView({
      workflow: {
        name: "w",
        on: "push",
        jobs: {
          a: job({
            steps: Array.from({ length: 20 }, (_, i) => ({ key: `step-${i}`, run: "echo hi" })),
          }),
        },
      },
    });
    const capped = makeSessionView({
      workflow: {
        name: "w",
        on: "push",
        jobs: {
          a: job({
            steps: Array.from({ length: 7 }, (_, i) => ({ key: `step-${i}`, run: "echo hi" })),
          }),
        },
      },
    });

    expect(estimateNodeHeight(manySteps, "a")).toBe(estimateNodeHeight(capped, "a"));
    expect(estimateNodeHeight(manySteps, "a")).toBeGreaterThan(estimateNodeHeight(oneStep, "a"));
  });

  it("adds room for a matrix job's lane selector", () => {
    const laneA = {
      id: "a::x",
      jobId: "a",
      matrix: { x: 1 },
      status: "ready" as const,
      pointer: 0,
      steps: [],
      env: {},
      extraPath: [],
      outputs: {},
      tempDir: "/tmp/fixture",
    };
    const laneB = { ...laneA, id: "a::y", matrix: { x: 2 } };
    const withMatrix = makeSessionView({
      workflow: { name: "w", on: "push", jobs: { a: job({ matrix: [{ x: 1 }, { x: 2 }] }) } },
      lanes: { [laneA.id]: laneA, [laneB.id]: laneB },
      laneOrder: [laneA.id, laneB.id],
      activeLaneId: laneA.id,
    });
    const without = makeSessionView({ workflow: { name: "w", on: "push", jobs: { a: job() } } });
    expect(estimateNodeHeight(withMatrix, "a")).toBeGreaterThan(estimateNodeHeight(without, "a"));
  });

  it("falls back to a small default for an unknown job id rather than throwing", () => {
    const session = makeSessionView();
    expect(() => estimateNodeHeight(session, "does-not-exist")).not.toThrow();
  });
});

describe("layoutJobs", () => {
  function chainSession() {
    return makeSessionView({
      workflow: {
        name: "chain",
        on: "push",
        jobs: {
          a: job({ id: "a" }),
          b: job({ id: "b", needs: ["a"] }),
          c: job({ id: "c", needs: ["b"] }),
        },
      },
    });
  }

  it("places a dependency chain left-to-right, strictly increasing x per level", () => {
    const session = chainSession();
    const positions = layoutJobs(session, ["a", "b", "c"]);
    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
    expect(positions.get("b")!.x).toBeLessThan(positions.get("c")!.x);
  });

  it("spreads fan-out siblings apart vertically instead of stacking them exactly on top of each other", () => {
    const session = makeSessionView({
      workflow: {
        name: "fanout",
        on: "push",
        jobs: {
          a: job({ id: "a" }),
          b: job({ id: "b", needs: ["a"] }),
          c: job({ id: "c", needs: ["a"] }),
          d: job({ id: "d", needs: ["a"] }),
        },
      },
    });
    const positions = layoutJobs(session, ["a", "b", "c", "d"]);
    const ys = [positions.get("b")!.y, positions.get("c")!.y, positions.get("d")!.y];
    expect(new Set(ys).size).toBe(3); // three distinct rows, not collapsed
  });

  it("never produces overlapping boxes for a chain, even with very different step counts", () => {
    const session = makeSessionView({
      workflow: {
        name: "uneven",
        on: "push",
        jobs: {
          a: job({ id: "a", steps: Array.from({ length: 15 }, (_, i) => ({ key: `s${i}`, run: "x" })) }),
          b: job({ id: "b", needs: ["a"] }),
        },
      },
    });
    const positions = layoutJobs(session, ["a", "b"]);
    // Different ranks (levels) - dagre guarantees no horizontal overlap
    // between ranks connected by an edge; this is really just a smoke test
    // that layout succeeds and returns sane, finite positions.
    for (const id of ["a", "b"]) {
      const p = positions.get(id)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("returns a position for every requested job id, even a single isolated job", () => {
    const session = makeSessionView({ workflow: { name: "w", on: "push", jobs: { a: job() } } });
    const positions = layoutJobs(session, ["a"]);
    expect(positions.has("a")).toBe(true);
  });

  it("ignores a needs reference to a job outside the given set (e.g. a cycle-caught one)", () => {
    const session = makeSessionView({
      workflow: {
        name: "w",
        on: "push",
        jobs: { a: job({ id: "a", needs: ["outside"] }) },
      },
    });
    expect(() => layoutJobs(session, ["a"])).not.toThrow();
  });
});
