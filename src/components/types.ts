import type { Lane } from "@/lib/engine/types";
import type { SessionView } from "@/lib/engine/serialize";

export interface Selection {
  laneId: string;
  stepIndex: number;
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
