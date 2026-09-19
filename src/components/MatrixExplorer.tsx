"use client";

import { useState } from "react";
import type { SessionView } from "@/lib/engine/serialize";
import { comboLabel } from "@/lib/workflow/matrix";
import { statusStyle } from "./statusStyles";
import { focusedLaneLabel } from "./focusLane";

// Below this many combinations (summed across every matrix job) a search
// box is one more thing to click past rather than a help - a handful of
// rows is already fast to scan by eye.
const FILTER_THRESHOLD = 6;

export function MatrixExplorer({
  session,
  selectedLaneId,
  onSelectLane,
  focusedLaneId,
  onToggleFocus,
}: {
  session: SessionView;
  /** The lane the graph/detail panel are currently showing - may differ
   * from session.activeLaneId (e.g. after "jump to failure" or clicking a
   * step directly in a lane that isn't the steppable one). This tab should
   * agree with what's on screen elsewhere, not silently show something else. */
  selectedLaneId: string | null;
  onSelectLane: (laneId: string) => void;
  /** The lane "Debug this combination only" is currently focused on, if any. */
  focusedLaneId: string | null;
  onToggleFocus: (laneId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const matrixJobs = Object.values(session.workflow.jobs).filter((j) => (j.matrix?.length ?? 0) > 0);
  const totalLanes = matrixJobs.reduce(
    (n, job) => n + session.laneOrder.filter((id) => session.lanes[id].jobId === job.id).length,
    0
  );

  if (matrixJobs.length === 0) {
    return <p className="text-sm text-ink-500">No job in this workflow uses a build matrix.</p>;
  }

  const needle = filter.trim().toLowerCase();
  const focusedLabel = focusedLaneId ? focusedLaneLabel(session, focusedLaneId) : null;

  return (
    <div className="space-y-4">
      {focusedLabel && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-status-breakpoint/40 bg-status-breakpoint/10 px-2 py-1.5 text-xs text-status-breakpoint">
          <span className="truncate">🎯 Focused: {focusedLabel}</span>
          <button
            onClick={() => onToggleFocus(focusedLaneId!)}
            className="shrink-0 rounded border border-status-breakpoint/50 px-2 py-0.5 hover:bg-status-breakpoint/20"
          >
            Show all combinations
          </button>
        </div>
      )}

      {totalLanes > FILTER_THRESHOLD && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${totalLanes} combinations…`}
          data-testid="matrix-filter"
          className="w-full rounded-md border border-bg-border bg-bg-panel px-2 py-1.5 text-xs text-ink-200 placeholder:text-ink-600 focus:border-status-running focus:outline-none"
        />
      )}

      {matrixJobs.map((job) => {
        const lanes = session.laneOrder
          .map((id) => session.lanes[id])
          .filter((l) => l.jobId === job.id)
          .filter(
            (l) =>
              needle === "" ||
              comboLabel(l.matrix).toLowerCase().includes(needle) ||
              (job.name ?? job.id).toLowerCase().includes(needle)
          );
        if (lanes.length === 0) return null;
        return (
          <div key={job.id}>
            <h3 className="mb-1 text-sm font-semibold text-ink">{job.name ?? job.id}</h3>
            <div className="space-y-1">
              {lanes.map((lane) => {
                const isFocused = lane.id === focusedLaneId;
                const deemphasized = focusedLaneId !== null && !isFocused;
                return (
                  <div
                    key={lane.id}
                    className={`flex items-center gap-1 ${deemphasized ? "opacity-40" : ""}`}
                  >
                    <button
                      onClick={() => onSelectLane(lane.id)}
                      title={
                        lane.id === session.activeLaneId && lane.id !== selectedLaneId
                          ? "This is the steppable lane (Step/Continue act on it)"
                          : undefined
                      }
                      className={`flex min-w-0 flex-1 items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs ${
                        isFocused
                          ? "border-status-breakpoint bg-status-breakpoint/10"
                          : lane.id === selectedLaneId
                            ? "border-status-running bg-bg-raised"
                            : "border-bg-border bg-bg-panel hover:bg-bg-raised"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-ink-200">
                        {lane.id === session.activeLaneId && (
                          <span className="shrink-0 text-status-running" aria-label="steppable lane">
                            ●
                          </span>
                        )}
                        <span className="truncate">{comboLabel(lane.matrix)}</span>
                      </span>
                      <span
                        className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${statusStyle(lane.status).badgeClass}`}
                      >
                        {statusStyle(lane.status).glyph} {lane.status}
                      </span>
                    </button>
                    <button
                      onClick={() => onToggleFocus(lane.id)}
                      title={isFocused ? "Show all combinations" : "Debug this combination only"}
                      className={`shrink-0 rounded px-1.5 py-1.5 text-xs ${
                        isFocused ? "text-status-breakpoint" : "text-ink-500 hover:text-ink-200"
                      }`}
                    >
                      🎯
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
