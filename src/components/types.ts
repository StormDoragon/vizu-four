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
  onSelectStep: (s: Selection) => void;
  onToggleBreakpoint: (jobId: string, stepKey: string, enabled: boolean) => void;
  onSelectLane: (laneId: string) => void;
}
