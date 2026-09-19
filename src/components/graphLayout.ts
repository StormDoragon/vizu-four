import dagre from "@dagrejs/dagre";
import type { SessionView } from "@/lib/engine/serialize";

/** Matches JobNode's actual rendered dimensions closely enough for dagre's
 * spacing decisions - doesn't need to be pixel-perfect, just proportionally
 * right so bigger nodes get the room they need. */
const NODE_WIDTH = 288; // w-72
const HEADER_HEIGHT = 40;
const IF_ROW_HEIGHT = 22;
const MATRIX_SELECT_HEIGHT = 30;
const STEP_ROW_HEIGHT = 30;
const EMPTY_STEPS_HEIGHT = 32;
/** JobNode's step list caps at `max-h-56` (224px) and scrolls beyond that -
 * a node with more steps than this doesn't need to keep growing taller. */
const MAX_VISIBLE_STEPS = 7;

export interface GraphPosition {
  x: number;
  y: number;
}

/** Estimates a job node's rendered height from its own content, so a job
 * with a matrix selector or many steps gets proportionally more room in
 * the layout than a bare one-step job. */
export function estimateNodeHeight(session: SessionView, jobId: string): number {
  const job = session.workflow.jobs[jobId];
  if (!job) return HEADER_HEIGHT + EMPTY_STEPS_HEIGHT;
  const hasMultipleLanes =
    session.laneOrder.filter((id) => session.lanes[id].jobId === jobId).length > 1;
  const stepsHeight =
    job.steps.length === 0
      ? EMPTY_STEPS_HEIGHT
      : Math.min(job.steps.length, MAX_VISIBLE_STEPS) * STEP_ROW_HEIGHT;
  return (
    HEADER_HEIGHT +
    (job.if ? IF_ROW_HEIGHT : 0) +
    (hasMultipleLanes ? MATRIX_SELECT_HEIGHT : 0) +
    stepsHeight
  );
}

/**
 * Lays out a workflow's jobs left-to-right by dependency level, using
 * dagre's layered (Sugiyama-style) algorithm instead of a fixed grid -
 * dagre minimizes edge crossings and spaces rows by each node's actual
 * height, so a workflow with many jobs or uneven fan-out/fan-in doesn't
 * degenerate into overlapping boxes or unreadable crossing edges the way a
 * naive `x: level * W, y: index * H` grid does.
 *
 * Only jobs reachable from `session.graph.levels` (i.e. not caught in a
 * `needs` cycle) are laid out here - dagre requires a DAG. Cycle-caught
 * jobs are the caller's responsibility to place separately.
 */
export function layoutJobs(
  session: SessionView,
  jobIds: string[]
): Map<string, GraphPosition> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const idSet = new Set(jobIds);
  for (const jobId of jobIds) {
    g.setNode(jobId, { width: NODE_WIDTH, height: estimateNodeHeight(session, jobId) });
  }
  for (const jobId of jobIds) {
    const job = session.workflow.jobs[jobId];
    for (const dep of job.needs) {
      // A `needs` on a job outside this DAG (unknown, or itself cycle-
      // caught) has nowhere to attach to here.
      if (idSet.has(dep)) g.setEdge(dep, jobId);
    }
  }

  dagre.layout(g);

  const positions = new Map<string, GraphPosition>();
  for (const jobId of jobIds) {
    const node = g.node(jobId);
    // dagre positions by center; React Flow positions by top-left corner.
    positions.set(jobId, { x: node.x - node.width / 2, y: node.y - node.height / 2 });
  }
  return positions;
}
