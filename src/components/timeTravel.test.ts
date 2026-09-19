import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  clampToHistory,
  isLiveSelection,
  liveSelection,
  liveStepIndex,
} from "./timeTravel";
import { makeSessionView, makeStepRecord } from "./testSupport/sessionFixture";
import type { Lane } from "@/lib/engine/types";

function lane(overrides: Partial<Lane> = {}): Lane {
  return {
    id: "build::default",
    jobId: "build",
    matrix: {},
    status: "paused",
    pointer: 0,
    steps: [makeStepRecord(), makeStepRecord(), makeStepRecord()],
    env: {},
    extraPath: [],
    outputs: {},
    tempDir: "/tmp/fixture",
    ...overrides,
  };
}

describe("liveStepIndex", () => {
  it("is the pointer while mid-run", () => {
    expect(liveStepIndex(lane({ pointer: 1 }))).toBe(1);
  });

  it("clamps to the last step once the lane has finished (pointer past the end)", () => {
    expect(liveStepIndex(lane({ pointer: 3, status: "success" }))).toBe(2);
  });

  it("is 0 before anything has run", () => {
    expect(liveStepIndex(lane({ pointer: 0 }))).toBe(0);
  });

  it("is -1 for a lane with no steps", () => {
    expect(liveStepIndex(lane({ steps: [], pointer: 0 }))).toBe(-1);
  });
});

describe("isLiveSelection", () => {
  it("is true when selection is null - nothing to distinguish it from yet", () => {
    const session = makeSessionView();
    expect(isLiveSelection(session, null)).toBe(true);
  });

  it("is true for the active lane at its live step index", () => {
    const l = lane({ pointer: 1 });
    const session = makeSessionView({ lanes: { [l.id]: l }, laneOrder: [l.id], activeLaneId: l.id });
    expect(isLiveSelection(session, { laneId: l.id, stepIndex: 1 })).toBe(true);
  });

  it("is false for an earlier step in the active lane", () => {
    const l = lane({ pointer: 2 });
    const session = makeSessionView({ lanes: { [l.id]: l }, laneOrder: [l.id], activeLaneId: l.id });
    expect(isLiveSelection(session, { laneId: l.id, stepIndex: 0 })).toBe(false);
  });

  it("is false for a different (non-active) lane, even at its own live index", () => {
    const active = lane({ id: "build::a", pointer: 1 });
    const other = lane({ id: "build::b", pointer: 2 });
    const session = makeSessionView({
      lanes: { [active.id]: active, [other.id]: other },
      laneOrder: [active.id, other.id],
      activeLaneId: active.id,
    });
    expect(isLiveSelection(session, { laneId: other.id, stepIndex: 2 })).toBe(false);
  });
});

describe("clampToHistory", () => {
  it("passes through an index within range", () => {
    expect(clampToHistory(lane({ pointer: 2 }), 1)).toBe(1);
  });

  it("clamps a negative index up to 0", () => {
    expect(clampToHistory(lane({ pointer: 2 }), -5)).toBe(0);
  });

  it("clamps an index past the live cursor back down to it - never ahead of the debugger", () => {
    expect(clampToHistory(lane({ pointer: 1 }), 2)).toBe(1);
  });
});

describe("canGoBack / canGoForward", () => {
  it("canGoBack is false at step 0, true anywhere after", () => {
    expect(canGoBack({ laneId: "x", stepIndex: 0 })).toBe(false);
    expect(canGoBack({ laneId: "x", stepIndex: 1 })).toBe(true);
  });

  it("canGoForward stops exactly at the live cursor, not one step later", () => {
    const l = lane({ pointer: 2 });
    expect(canGoForward(l, { laneId: l.id, stepIndex: 1 })).toBe(true);
    expect(canGoForward(l, { laneId: l.id, stepIndex: 2 })).toBe(false);
  });
});

describe("liveSelection", () => {
  it("returns the active lane at its live step index", () => {
    const l = lane({ pointer: 1 });
    const session = makeSessionView({ lanes: { [l.id]: l }, laneOrder: [l.id], activeLaneId: l.id });
    expect(liveSelection(session)).toEqual({ laneId: l.id, stepIndex: 1 });
  });

  it("returns null when there is no active lane (e.g. every job still blocked)", () => {
    const session = makeSessionView({ activeLaneId: null });
    expect(liveSelection(session)).toBe(null);
  });
});
