import type { Lane } from "@/lib/engine/types";
import type { SessionView } from "@/lib/engine/serialize";
import type { Selection } from "./types";

/**
 * The step index the debugger "cursor" sits on for a lane: the next step
 * to run, or the last step once the lane has finished. This is the same
 * formula already used across DebuggerApp for "select whatever's current"
 * (initial load, after a control action, after switching lanes) - hoisted
 * here so time-travel navigation and the live/history distinction share
 * one definition instead of drifting apart from those call sites.
 */
export function liveStepIndex(lane: Lane): number {
  if (lane.steps.length === 0) return -1;
  return Math.max(0, Math.min(lane.pointer, lane.steps.length - 1));
}

/**
 * True when `selection` is exactly the live cursor - the active lane, at
 * its live step index. Anything else (a different lane, or an earlier step
 * in the active lane) is "viewing history": informative only, and never
 * what Step/Continue/Run act on (those always target `activeLaneId`).
 * `selection === null` counts as live - there's nothing to distinguish it
 * from yet.
 */
export function isLiveSelection(session: SessionView, selection: Selection | null): boolean {
  if (!selection) return true;
  if (selection.laneId !== session.activeLaneId) return false;
  const lane = session.lanes[selection.laneId];
  return !!lane && selection.stepIndex === liveStepIndex(lane);
}

/**
 * Clamps a candidate step index into the navigable time-travel range for a
 * lane: from its first step up to (and including) the live cursor. You can
 * look at any step the debugger has already reached; never ahead of it,
 * since there's nothing to show for a step that hasn't run.
 */
export function clampToHistory(lane: Lane, stepIndex: number): number {
  const max = liveStepIndex(lane);
  if (max < 0) return 0;
  return Math.max(0, Math.min(stepIndex, max));
}

/** Whether the "previous step" time-travel control has anywhere to go. */
export function canGoBack(selection: Selection): boolean {
  return selection.stepIndex > 0;
}

/** Whether the "next step" time-travel control has anywhere to go, without
 * running past the live cursor into a step that hasn't executed yet. */
export function canGoForward(lane: Lane, selection: Selection): boolean {
  return selection.stepIndex < liveStepIndex(lane);
}

/** The selection to land on when the user asks to jump back to "live" -
 * the active lane, at its live step index. Null if there's no active lane
 * to jump to (e.g. every job is still blocked on `needs`). */
export function liveSelection(session: SessionView): Selection | null {
  if (!session.activeLaneId) return null;
  const lane = session.lanes[session.activeLaneId];
  const idx = liveStepIndex(lane);
  if (idx < 0) return null;
  return { laneId: session.activeLaneId, stepIndex: idx };
}
