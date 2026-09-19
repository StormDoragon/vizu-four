"use client";

import type { SessionView } from "@/lib/engine/serialize";
import type { Selection } from "./types";
import { canGoBack, canGoForward, isLiveSelection, liveSelection, liveStepIndex } from "./timeTravel";

/**
 * A slim strip above the step detail panel: which step you're looking at,
 * whether that's the live debugger cursor or history, and controls to move
 * between the two. Deliberately separate from clicking a step in the graph
 * (which still works) - this is the explicit "you can go back" affordance,
 * and the one place the live/history distinction is stated outright rather
 * than left for the viewer to infer from the graph's highlight alone.
 */
export function TimeTravelBar({
  session,
  selection,
  onSelect,
}: {
  session: SessionView;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const laneId = selection?.laneId ?? session.activeLaneId;
  const lane = laneId ? session.lanes[laneId] : null;
  if (!lane || lane.steps.length === 0) return null;

  const current: Selection = selection ?? { laneId: lane.id, stepIndex: liveStepIndex(lane) };
  const live = isLiveSelection(session, selection);
  const job = session.workflow.jobs[lane.jobId];
  const step = job?.steps[current.stepIndex];
  const stepLabel = step?.name ?? step?.uses ?? step?.key ?? `step ${current.stepIndex + 1}`;
  const total = lane.steps.length;
  const target = liveSelection(session);

  return (
    <div className="flex items-center gap-2 border-b border-bg-border bg-bg-panel px-3 py-1.5 text-xs">
      <button
        onClick={() => onSelect({ laneId: current.laneId, stepIndex: current.stepIndex - 1 })}
        disabled={!canGoBack(current)}
        title="Previous step"
        aria-label="Previous step"
        className="rounded border border-bg-border px-1.5 py-0.5 text-gray-300 hover:border-status-running hover:text-white disabled:opacity-30"
      >
        ◀
      </button>
      <button
        onClick={() => onSelect({ laneId: current.laneId, stepIndex: current.stepIndex + 1 })}
        disabled={!canGoForward(lane, current)}
        title="Next step"
        aria-label="Next step"
        className="rounded border border-bg-border px-1.5 py-0.5 text-gray-300 hover:border-status-running hover:text-white disabled:opacity-30"
      >
        ▶
      </button>

      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          live ? "bg-status-success/20 text-status-success" : "bg-status-breakpoint/20 text-status-breakpoint"
        }`}
        data-testid="time-travel-badge"
      >
        {live ? "live" : "history"}
      </span>

      <span className="text-gray-400">
        step {current.stepIndex + 1} of {total}
        {job && <span className="text-gray-600"> — {stepLabel}</span>}
      </span>

      {!live && target && (
        <button
          onClick={() => onSelect(target)}
          data-testid="jump-to-live"
          className="ml-auto rounded-md border border-status-running/50 bg-status-running/10 px-2 py-1 text-status-running hover:bg-status-running/20"
        >
          Jump to live
        </button>
      )}
    </div>
  );
}
