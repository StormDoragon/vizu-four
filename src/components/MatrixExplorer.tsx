"use client";

import type { SessionView } from "@/lib/engine/serialize";
import { comboLabel } from "@/lib/workflow/matrix";

function statusBadgeClass(status: string): string {
  switch (status) {
    case "success":
      return "bg-status-success/20 text-status-success";
    case "failure":
      return "bg-status-failure/20 text-status-failure";
    case "skipped":
    case "cancelled":
      return "bg-status-skipped/20 text-status-skipped";
    case "running":
      return "bg-status-running/20 text-status-running";
    case "paused":
      return "bg-status-breakpoint/20 text-status-breakpoint";
    default:
      return "bg-gray-700/40 text-gray-400";
  }
}

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
    return <p className="text-sm text-gray-500">No job in this workflow uses a build matrix.</p>;
  }

  return (
    <div className="space-y-4">
      {matrixJobs.map((job) => {
        const lanes = session.laneOrder.map((id) => session.lanes[id]).filter((l) => l.jobId === job.id);
        return (
          <div key={job.id}>
            <h3 className="mb-1 text-sm font-semibold text-white">{job.name ?? job.id}</h3>
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
                  <span className="flex items-center gap-1.5 text-gray-200">
                    {lane.id === session.activeLaneId && (
                      <span className="text-status-running" aria-label="steppable lane">
                        ●
                      </span>
                    )}
                    {comboLabel(lane.matrix)}
                  </span>
                  <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${statusBadgeClass(lane.status)}`}>
                    {lane.status}
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
