import type { Lane } from "@/lib/engine/types";
import type { SessionView } from "@/lib/engine/serialize";

export interface Selection {
  laneId: string;
  stepIndex: number;
}

/** Every currently-failed step across the whole session, in lane/step order. */
export function findFailures(session: SessionView): Selection[] {
  const failures: Selection[] = [];
  for (const laneId of session.laneOrder) {
    const lane = session.lanes[laneId];
    lane.steps.forEach((step, stepIndex) => {
      if (step.conclusion === "failure") failures.push({ laneId, stepIndex });
    });
  }
  return failures;
}

export interface JobNodeData extends Record<string, unknown> {
  session: SessionView;
  jobId: string;
  laneId: string;
  lanesForJob: Lane[];
  isActiveLaneJob: boolean;
  selection: Selection | null;
  /** A control request is in flight. Combined with a lane's own pointer to
   * animate whichever step is actually executing right now - the client's
   * own "in flight" signal is the only place this is ever observable, since
   * the engine resolves and clears a lane's "running" status entirely
   * server-side within one request/response cycle. */
  busy: boolean;
  onSelectStep: (s: Selection) => void;
  onToggleBreakpoint: (jobId: string, stepKey: string, enabled: boolean) => void;
  onSelectLane: (laneId: string) => void;
}
