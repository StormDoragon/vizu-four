"use client";

import { useState } from "react";
import type { SessionView } from "@/lib/engine/serialize";
import { explainFailure, type FailureExplanation } from "@/lib/apiClient";
import type { Selection } from "./types";

const STATUS_TEXT_COLOR: Record<string, string> = {
  success: "text-status-success",
  failure: "text-status-failure",
  skipped: "text-status-skipped",
  running: "text-status-running",
  pending: "text-gray-500",
};

export function StepDetailPanel({
  session,
  selection,
}: {
  session: SessionView;
  selection: Selection | null;
}) {
  const [explanation, setExplanation] = useState<FailureExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  if (!selection || !session.lanes[selection.laneId]) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-600">
        Select a step in the graph to see its output.
      </div>
    );
  }

  const lane = session.lanes[selection.laneId];
  const job = session.workflow.jobs[lane.jobId];
  const step = job.steps[selection.stepIndex];
  const record = lane.steps[selection.stepIndex];

  async function explain() {
    setExplaining(true);
    setExplainError(null);
    try {
      const { explanation } = await explainFailure(session.id, lane.id, selection!.stepIndex);
      setExplanation(explanation);
    } catch (err) {
      setExplainError((err as Error).message);
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="grid h-full grid-cols-2 divide-x divide-bg-border">
      <div className="overflow-auto p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span className="font-semibold text-white">{step.name ?? step.uses ?? step.key}</span>
          {record.status !== "pending" && (
            <span className={`font-semibold ${STATUS_TEXT_COLOR[record.status] ?? "text-gray-400"}`}>
              {record.status}
            </span>
          )}
          {record.exitCode !== undefined && record.exitCode !== null && <span>exit {record.exitCode}</span>}
          {record.durationMs !== undefined && <span>{record.durationMs}ms</span>}
          {record.continueOnError && <span className="rounded bg-gray-700/50 px-1.5 py-0.5">continue-on-error</span>}
          {record.simulated && <span className="rounded bg-gray-700/50 px-1.5 py-0.5">simulated</span>}
        </div>

        {record.ifExpr !== undefined && (
          <div className="mb-2 text-xs text-gray-500">
            if: <code className="text-gray-400">{record.ifExpr}</code> →{" "}
            <span className={record.ifResult ? "text-status-success" : "text-gray-500"}>
              {String(record.ifResult)}
            </span>
            {record.ifWarning && <div className="mt-1 text-yellow-400">⚠ {record.ifWarning}</div>}
            {record.ifError && <div className="mt-1 text-red-400">{record.ifError}</div>}
          </div>
        )}

        {record.simulationNote && <p className="mb-2 text-xs italic text-gray-500">{record.simulationNote}</p>}
        {record.engineError && <p className="mb-2 text-xs text-red-400">{record.engineError}</p>}

        {record.stdout || record.stderr ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-300">
            {record.stdout}
            {record.stderr && <span className="text-red-300">{record.stderr}</span>}
          </pre>
        ) : (
          <p className="text-xs italic text-gray-600">No output yet.</p>
        )}

        {record.summary && (
          <div className="mt-3 border-t border-bg-border pt-2">
            <h4 className="mb-1 text-xs font-semibold text-gray-400">Step summary</h4>
            <pre className="whitespace-pre-wrap text-xs text-gray-300">{record.summary}</pre>
          </div>
        )}

        {Object.keys(record.outputs).length > 0 && (
          <div className="mt-3 border-t border-bg-border pt-2">
            <h4 className="mb-1 text-xs font-semibold text-gray-400">Outputs</h4>
            <pre className="whitespace-pre-wrap text-xs text-gray-300">
              {JSON.stringify(record.outputs, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="overflow-auto p-3">
        {record.conclusion === "failure" ? (
          <div>
            <button
              onClick={explain}
              disabled={explaining}
              className="mb-3 rounded-md bg-status-failure/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-status-failure disabled:opacity-50"
            >
              {explaining ? "Analyzing…" : "Explain this failure"}
            </button>
            {explainError && <p className="text-xs text-red-400">{explainError}</p>}
            {explanation && (
              <div className="space-y-2">
                <p className="text-xs text-gray-300">{explanation.summary}</p>
                <p className="text-[10px] uppercase tracking-wide text-gray-600">
                  {explanation.source === "claude" ? "AI-generated (Claude)" : "Heuristic analysis"}
                </p>
                {explanation.causes.map((cause, i) => (
                  <div key={i} className="rounded-md border border-bg-border bg-bg-panel p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-100">{cause.title}</span>
                      <span className="shrink-0 text-[10px] uppercase text-gray-500">{cause.confidence}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{cause.detail}</p>
                    {cause.suggestion && <p className="mt-1 text-xs text-status-success">→ {cause.suggestion}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600">No failure to explain for this step.</p>
        )}
      </div>
    </div>
  );
}
