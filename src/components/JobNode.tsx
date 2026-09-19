"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { comboLabel } from "@/lib/workflow/matrix";
import { StatusDot } from "./StatusDot";
import { statusStyle } from "./statusStyles";
import type { JobNodeData } from "./types";

const TERMINAL_LANE = new Set(["success", "failure", "skipped", "cancelled"]);

type JobFlowNode = Node<JobNodeData, "job">;

export function JobNode({ data }: NodeProps<JobFlowNode>) {
  const {
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
  } = data;
  const job = session.workflow.jobs[jobId];
  const lane = session.lanes[laneId];
  // While a control request is in flight, this lane's own next step is the
  // one actually executing - the only place that's ever true is client-
  // side (see JobNodeData.busy).
  const laneExecuting = busy && !!lane && !TERMINAL_LANE.has(lane.status) && lane.status !== "blocked";

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
        {lane && <StatusDot status={lane.status} executing={laneExecuting} size="md" />}
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
          const isNext = !!lane && lane.pointer === idx && !TERMINAL_LANE.has(lane.status);
          const isSelected = !!lane && selection?.laneId === lane.id && selection.stepIndex === idx;
          const stepScopeKey = `${jobId}:${step.key}`;
          const hasBreakpoint = session.breakpoints.includes(stepScopeKey);
          const hasMock = !!session.mockOutputs[stepScopeKey];
          const style = statusStyle(record?.status ?? "pending");
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
              <StatusDot status={record?.status ?? "pending"} executing={isNext && laneExecuting} />
              <span className="truncate text-gray-200">{step.name ?? step.uses ?? step.key}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {hasMock && (
                  <span
                    className="text-[10px] text-status-breakpoint"
                    title="Mock outputs configured for this step"
                  >
                    mock
                  </span>
                )}
                {record?.simulated && <span className="text-[10px] text-gray-500">sim</span>}
                {/* Redundant, non-color signal for a finished step's
                    outcome (WCAG 1.4.1) - the dot to its left already
                    carries color + shape, this adds the glyph too. */}
                {record?.status && record.status !== "pending" && (
                  <span className={`text-[10px] ${style.textClass}`} aria-hidden="true">
                    {style.glyph}
                  </span>
                )}
              </span>
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
