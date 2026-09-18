"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SessionView } from "@/lib/engine/serialize";
import { JobNode } from "./JobNode";
import type { JobNodeData, Selection } from "./types";

const nodeTypes = { job: JobNode };

export function WorkflowGraph({
  session,
  selection,
  onSelectStep,
  onToggleBreakpoint,
  onSelectLane,
}: {
  session: SessionView;
  selection: Selection | null;
  onSelectStep: (s: Selection) => void;
  onToggleBreakpoint: (jobId: string, stepKey: string, enabled: boolean) => void;
  onSelectLane: (laneId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node<JobNodeData, "job">[] = [];
    const edges: Edge[] = [];
    const jobIds = Object.keys(session.workflow.jobs);
    const levels = session.graph.levels.length > 0 ? session.graph.levels : [jobIds];
    const placed = new Set<string>();

    levels.forEach((level, levelIndex) => {
      level.forEach((jobId, i) => {
        placed.add(jobId);
        const job = session.workflow.jobs[jobId];
        const lanesForJob = session.laneOrder
          .map((id) => session.lanes[id])
          .filter((l) => l.jobId === jobId);
        const active = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
        const isActiveLaneJob = active?.jobId === jobId;
        const laneId = isActiveLaneJob ? active!.id : lanesForJob[0]?.id ?? "";

        nodes.push({
          id: jobId,
          type: "job",
          position: { x: levelIndex * 340, y: i * 280 },
          data: {
            session,
            jobId,
            laneId,
            lanesForJob,
            isActiveLaneJob,
            selection,
            onSelectStep,
            onToggleBreakpoint,
            onSelectLane,
          },
          draggable: false,
        });

        for (const dep of job.needs) {
          edges.push({
            id: `${dep}->${jobId}`,
            source: dep,
            target: jobId,
            style: { stroke: "#3a4353" },
          });
        }
      });
    });

    // Jobs caught in a `needs` cycle (reported separately, not in `levels`) still get placed
    // so the graph doesn't silently drop them.
    for (const [i, jobId] of session.graph.cycles.flat().entries()) {
      if (placed.has(jobId)) continue;
      const job = session.workflow.jobs[jobId];
      const lanesForJob = session.laneOrder.map((id) => session.lanes[id]).filter((l) => l.jobId === jobId);
      nodes.push({
        id: jobId,
        type: "job",
        position: { x: levels.length * 340, y: i * 280 },
        data: {
          session,
          jobId,
          laneId: lanesForJob[0]?.id ?? "",
          lanesForJob,
          isActiveLaneJob: false,
          selection,
          onSelectStep,
          onToggleBreakpoint,
          onSelectLane,
        },
        draggable: false,
      });
      for (const dep of job.needs) {
        edges.push({ id: `${dep}->${jobId}`, source: dep, target: jobId, style: { stroke: "#f85149" } });
      }
    }

    return { nodes, edges };
  }, [session, selection, onSelectStep, onToggleBreakpoint, onSelectLane]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView className="bg-bg">
      <Background color="#232a37" gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
