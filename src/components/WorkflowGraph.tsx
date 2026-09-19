"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SessionView } from "@/lib/engine/serialize";
import { JobNode } from "./JobNode";
import { layoutJobs } from "./graphLayout";
import type { JobNodeData, Selection } from "./types";

const nodeTypes = { job: JobNode };

export function WorkflowGraph({
  session,
  selection,
  busy,
  onSelectStep,
  onToggleBreakpoint,
  onSelectLane,
}: {
  session: SessionView;
  selection: Selection | null;
  /** A control request is in flight - passed through to JobNode so it can
   * animate whichever step is actually executing right now. */
  busy: boolean;
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
    const laidOutIds = levels.flat();
    // dagre's layered (Sugiyama-style) algorithm replaces the old fixed
    // grid (`x: level * 340, y: index * 280`), which didn't account for
    // varying node heights or fan-out/fan-in and just got worse the more
    // jobs a workflow had. Only jobs actually reachable from `levels` go
    // through it - dagre requires a DAG, and a `needs` cycle is reported
    // separately in `session.graph.cycles`.
    const positions = layoutJobs(session, laidOutIds);

    levels.forEach((level) => {
      level.forEach((jobId) => {
        placed.add(jobId);
        const job = session.workflow.jobs[jobId];
        const lanesForJob = session.laneOrder
          .map((id) => session.lanes[id])
          .filter((l) => l.jobId === jobId);
        const active = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
        const isActiveLaneJob = active?.jobId === jobId;
        // Prefer whichever lane the current selection points at (e.g. after
        // auto-jumping to a failure in a non-active matrix lane), so the
        // graph's dropdown/steps agree with what the bottom panel shows.
        const selectedLane = selection ? session.lanes[selection.laneId] : undefined;
        const laneId =
          selectedLane?.jobId === jobId
            ? selectedLane.id
            : isActiveLaneJob
              ? active!.id
              : (lanesForJob[0]?.id ?? "");

        nodes.push({
          id: jobId,
          type: "job",
          position: positions.get(jobId) ?? { x: 0, y: 0 },
          data: {
            session,
            jobId,
            laneId,
            lanesForJob,
            isActiveLaneJob,
            selection,
            busy,
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

    // Jobs caught in a `needs` cycle (reported separately, not in `levels`)
    // still get placed so the graph doesn't silently drop them - dagre
    // itself only handles the acyclic remainder above, so these fall back
    // to a simple column off to the right of it.
    const cycleColumnX = Math.max(0, ...[...positions.values()].map((p) => p.x)) + 340;
    for (const [i, jobId] of session.graph.cycles.flat().entries()) {
      if (placed.has(jobId)) continue;
      const job = session.workflow.jobs[jobId];
      const lanesForJob = session.laneOrder.map((id) => session.lanes[id]).filter((l) => l.jobId === jobId);
      const selectedLane = selection ? session.lanes[selection.laneId] : undefined;
      nodes.push({
        id: jobId,
        type: "job",
        position: { x: cycleColumnX, y: i * 280 },
        data: {
          session,
          jobId,
          laneId: selectedLane?.jobId === jobId ? selectedLane.id : (lanesForJob[0]?.id ?? ""),
          lanesForJob,
          isActiveLaneJob: false,
          selection,
          busy,
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
  }, [session, selection, busy, onSelectStep, onToggleBreakpoint, onSelectLane]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      className="bg-bg"
    >
      <Background color="#232a37" gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
