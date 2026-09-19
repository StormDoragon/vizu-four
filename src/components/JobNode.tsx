"use client";

import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { comboLabel } from "@/lib/workflow/matrix";
import { StatusDot } from "./StatusDot";
import { statusStyle } from "./statusStyles";
import type { JobNodeData } from "./types";

const TERMINAL_LANE = new Set(["success", "failure", "skipped", "cancelled"]);
// Below this many combinations the native <select> is already fast to
// scan - a filter box would just be one more thing to click past.
const FILTER_THRESHOLD = 8;

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
    focusedLaneId,
    onSelectStep,
    onToggleBreakpoint,
    onSelectLane,
    onToggleFocus,
  } = data;
  const [laneFilter, setLaneFilter] = useState("");
  const job = session.workflow.jobs[jobId];
  const lane = session.lanes[laneId];
  const isFocused = laneId === focusedLaneId;
  // While a control request is in flight, this lane's own next step is the
  // one actually executing - the only place that's ever true is client-
  // side (see JobNodeData.busy).
  const laneExecuting = busy && !!lane && !TERMINAL_LANE.has(lane.status) && lane.status !== "blocked";
  const filteredLanes =
    laneFilter.trim() === ""
      ? lanesForJob
      : lanesForJob.filter(
          (l) => l.id === laneId || comboLabel(l.matrix).toLowerCase().includes(laneFilter.trim().toLowerCase())
        );

  return (
    <div
      className={`w-72 rounded-lg border bg-bg-panel shadow-lg ${
        isFocused ? "border-status-breakpoint" : isActiveLaneJob ? "border-status-running" : "border-bg-border"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-bg-border" />
      <Handle type="source" position={Position.Right} className="!bg-bg-border" />

      <div className="flex items-center justify-between gap-2 rounded-t-lg bg-bg-raised px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="truncate text-sm font-semibold text-ink">{job.name ?? jobId}</div>
          {isFocused && (
            <span
              className="shrink-0 rounded bg-status-breakpoint/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-status-breakpoint"
              title="Debugging this combination only"
            >
              focused
            </span>
          )}
        </div>
        {lane && <StatusDot status={lane.status} executing={laneExecuting} size="md" />}
      </div>

      {job.if && (
        <div className="border-b border-bg-border px-2 py-1 text-[10px] text-ink-500">
          if: <code>{job.if}</code>
          {lane?.jobIfWarning && <span className="ml-1 text-yellow-400">⚠</span>}
        </div>
      )}

      {lanesForJob.length > 1 && (
        <div className="border-b border-bg-border bg-bg-panel">
          {lanesForJob.length > FILTER_THRESHOLD && (
            <input
              value={laneFilter}
              onChange={(e) => setLaneFilter(e.target.value)}
              placeholder={`filter ${lanesForJob.length} combinations…`}
              data-testid="lane-filter"
              className="w-full border-b border-bg-border bg-bg-panel px-2 py-1 text-xs text-ink-300 placeholder:text-ink-600 focus:outline-none"
            />
          )}
          <div className="flex items-center gap-1 px-1">
            <select
              value={laneId}
              onChange={(e) => onSelectLane(e.target.value)}
              className="min-w-0 flex-1 bg-bg-panel px-1 py-1 text-xs text-ink-300"
            >
              {filteredLanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {comboLabel(l.matrix)} — {l.status}
                </option>
              ))}
            </select>
            <button
              onClick={() => onToggleFocus(laneId)}
              title={isFocused ? "Show all combinations" : "Debug this combination only"}
              className={`shrink-0 rounded px-1.5 py-1 text-xs ${
                isFocused ? "text-status-breakpoint" : "text-ink-500 hover:text-ink-200"
              }`}
            >
              🎯
            </button>
          </div>
        </div>
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
                  hasBreakpoint ? "border-status-breakpoint bg-status-breakpoint" : "border-ink-600"
                }`}
              />
              <StatusDot status={record?.status ?? "pending"} executing={isNext && laneExecuting} />
              <span className="truncate text-ink-200">{step.name ?? step.uses ?? step.key}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {hasMock && (
                  <span
                    className="text-[10px] text-status-breakpoint"
                    title="Mock outputs configured for this step"
                  >
                    mock
                  </span>
                )}
                {record?.simulated && <span className="text-[10px] text-ink-500">sim</span>}
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
          <div className="px-2 py-2 text-xs italic text-ink-600">no steps</div>
        )}
      </div>
    </div>
  );
}
