"use client";

import type { SessionView } from "@/lib/engine/serialize";
import { comboLabel } from "@/lib/workflow/matrix";
import { statusStyle } from "./statusStyles";

export function MatrixExplorer({
  session,
  selectedLaneId,
  onSelectLane,
}: {
  session: SessionView;
  /** The lane the graph/detail panel are currently showing - may differ
   * from session.activeLaneId (e.g. after "jump to failure" or clicking a
   * step directly in a lane that isn't the steppable one). This tab should
   * agree with what's on screen elsewhere, not silently show something else. */
  selectedLaneId: string | null;
  onSelectLane: (laneId: string) => void;
}) {
  const matrixJobs = Object.values(session.workflow.jobs).filter((j) => (j.matrix?.length ?? 0) > 0);

  if (matrixJobs.length === 0) {
    return <p className="text-sm text-ink-500">No job in this workflow uses a build matrix.</p>;
  }

  return (
    <div className="space-y-4">
      {matrixJobs.map((job) => {
        const lanes = session.laneOrder.map((id) => session.lanes[id]).filter((l) => l.jobId === job.id);
        return (
          <div key={job.id}>
            <h3 className="mb-1 text-sm font-semibold text-ink">{job.name ?? job.id}</h3>
            <div className="space-y-1">
              {lanes.map((lane) => (
                <button
                  key={lane.id}
                  onClick={() => onSelectLane(lane.id)}
                  title={
                    lane.id === session.activeLaneId && lane.id !== selectedLaneId
                      ? "This is the steppable lane (Step/Continue act on it)"
                      : undefined
                  }
                  className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs ${
                    lane.id === selectedLaneId
                      ? "border-status-running bg-bg-raised"
                      : "border-bg-border bg-bg-panel hover:bg-bg-raised"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-ink-200">
                    {lane.id === session.activeLaneId && (
                      <span className="text-status-running" aria-label="steppable lane">
                        ●
                      </span>
                    )}
                    {comboLabel(lane.matrix)}
                  </span>
                  <span
                    className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${statusStyle(lane.status).badgeClass}`}
                  >
                    {statusStyle(lane.status).glyph} {lane.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
