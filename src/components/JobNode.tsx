"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { comboLabel } from "@/lib/workflow/matrix";
import type { JobNodeData } from "./types";

const STATUS_DOT: Record<string, string> = {
  pending: "bg-status-pending",
  running: "bg-status-running animate-pulse",
  paused: "bg-status-breakpoint",
  success: "bg-status-success",
  failure: "bg-status-failure",
  skipped: "bg-status-skipped",
  blocked: "bg-status-pending",
  ready: "bg-status-pending",
};

type JobFlowNode = Node<JobNodeData, "job">;

export function JobNode({ data }: NodeProps<JobFlowNode>) {
  const {
    session,
    jobId,
    laneId,
    lanesForJob,
    isActiveLaneJob,
    selection,
    onSelectStep,
    onToggleBreakpoint,
    onSelectLane,
  } = data;
  const job = session.workflow.jobs[jobId];
  const lane = session.lanes[laneId];

  return (
    <div
      className={`w-72 rounded-lg border bg-bg-panel shadow-lg ${
        isActiveLaneJob ? "border-status-running" : "border-bg-border"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-bg-border" />
      <Handle type="source" position={Position.Right} className="!bg-bg-border" />

      <div className="flex items-center justify-between gap-2 rounded-t-lg bg-bg-raised px-3 py-2">
        <div className="truncate text-sm font-semibold text-white">{job.name ?? jobId}</div>
        {lane && (
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[lane.status] ?? "bg-status-pending"}`}
            title={lane.status}
          />
        )}
      </div>

      {job.if && (
        <div className="border-b border-bg-border px-2 py-1 text-[10px] text-gray-500">
          if: <code>{job.if}</code>
          {lane?.jobIfWarning && <span className="ml-1 text-yellow-400">⚠</span>}
        </div>
      )}

      {lanesForJob.length > 1 && (
        <select
          value={laneId}
          onChange={(e) => onSelectLane(e.target.value)}
          className="w-full border-b border-bg-border bg-bg-panel px-2 py-1 text-xs text-gray-300"
        >
          {lanesForJob.map((l) => (
            <option key={l.id} value={l.id}>
              {comboLabel(l.matrix)} — {l.status}
            </option>
          ))}
        </select>
      )}

      <div className="max-h-56 overflow-y-auto">
        {job.steps.map((step, idx) => {
          const record = lane?.steps[idx];
          const isNext = !!lane && lane.pointer === idx && lane.status !== "success" && lane.status !== "failure" && lane.status !== "skipped";
          const isSelected = !!lane && selection?.laneId === lane.id && selection.stepIndex === idx;
          const bpKey = `${jobId}:${step.key}`;
          const hasBreakpoint = session.breakpoints.includes(bpKey);
          return (
            <div
              key={step.key}
              onClick={() => lane && onSelectStep({ laneId: lane.id, stepIndex: idx })}
              className={`flex cursor-pointer items-center gap-2 border-b border-bg-border/60 px-2 py-1.5 text-xs hover:bg-bg-raised ${
                isSelected ? "bg-bg-raised" : ""
              } ${isNext ? "ring-1 ring-inset ring-status-running" : ""}`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleBreakpoint(jobId, step.key, !hasBreakpoint);
                }}
                title="Toggle breakpoint"
                className={`h-2.5 w-2.5 shrink-0 rounded-full border ${
                  hasBreakpoint ? "border-status-breakpoint bg-status-breakpoint" : "border-gray-600"
                }`}
              />
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[record?.status ?? "pending"]}`} />
              <span className="truncate text-gray-200">{step.name ?? step.uses ?? step.key}</span>
              {record?.simulated && <span className="ml-auto shrink-0 text-[10px] text-gray-500">sim</span>}
            </div>
          );
        })}
        {job.steps.length === 0 && (
          <div className="px-2 py-2 text-xs italic text-gray-600">no steps</div>
        )}
      </div>
    </div>
  );
}
