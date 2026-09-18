import type { WorkflowFile } from "./types";

export interface JobGraph {
  /** Job ids grouped into dependency levels; level 0 has no unmet needs. */
  levels: string[][];
  /** Job id -> level index, for layout. */
  levelOf: Record<string, number>;
  /** Job id -> ids of jobs that depend on it. */
  dependents: Record<string, string[]>;
  cycles: string[][];
}

/**
 * Topologically sorts jobs by `needs` into levels (Kahn's algorithm), so the
 * UI can lay the graph out left-to-right and the engine knows which jobs are
 * eligible to start once their dependencies complete. Jobs participating in
 * a `needs` cycle are reported separately rather than silently dropped.
 */
export function buildJobGraph(workflow: WorkflowFile): JobGraph {
  const jobIds = Object.keys(workflow.jobs);
  const indegree: Record<string, number> = {};
  const dependents: Record<string, string[]> = {};

  for (const id of jobIds) {
    indegree[id] = 0;
    dependents[id] = [];
  }
  for (const id of jobIds) {
    const job = workflow.jobs[id];
    for (const dep of job.needs) {
      if (!workflow.jobs[dep]) continue; // unknown dep reported by parser as an issue
      indegree[id] += 1;
      dependents[dep].push(id);
    }
  }

  const levels: string[][] = [];
  const levelOf: Record<string, number> = {};
  const remaining = new Set(jobIds);
  const workingIndegree = { ...indegree };

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => workingIndegree[id] === 0);
    if (ready.length === 0) break; // cycle
    for (const id of ready) {
      levelOf[id] = levels.length;
      remaining.delete(id);
    }
    levels.push(ready.sort());
    for (const id of ready) {
      for (const dependent of dependents[id]) {
        workingIndegree[dependent] -= 1;
      }
    }
  }

  const cycles: string[][] = remaining.size > 0 ? [[...remaining].sort()] : [];

  return { levels, levelOf, dependents, cycles };
}
