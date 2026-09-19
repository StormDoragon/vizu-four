import type { SessionView } from "@/lib/engine/serialize";
import { comboLabel } from "@/lib/workflow/matrix";

/** Human-readable "<job> — <combo>" label for the focused lane badge, or
 * null if the id doesn't (or no longer) resolve to a lane in this session. */
export function focusedLaneLabel(session: SessionView, laneId: string): string | null {
  const lane = session.lanes[laneId];
  if (!lane) return null;
  const job = session.workflow.jobs[lane.jobId];
  return `${job?.name ?? lane.jobId} — ${comboLabel(lane.matrix)}`;
}
