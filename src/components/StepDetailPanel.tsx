"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionView } from "@/lib/engine/serialize";
import { explainFailure, type FailureExplanation } from "@/lib/apiClient";
import { MockOutputsEditor } from "./MockOutputsEditor";
import { statusStyle } from "./statusStyles";
import type { Selection } from "./types";

export function StepDetailPanel({
  session,
  selection,
  onSessionUpdate,
}: {
  session: SessionView;
  selection: Selection | null;
  onSessionUpdate: (s: SessionView) => void;
}) {
  const [explanation, setExplanation] = useState<FailureExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // Null-safe derivation so hooks below can run unconditionally, before the
  // "nothing selected" early return further down.
  const effectLane = selection ? session.lanes[selection.laneId] : undefined;
  const effectRecord = effectLane && selection ? effectLane.steps[selection.stepIndex] : undefined;
  const isFailure = effectRecord?.conclusion === "failure";

  // Auto-fetch the failure explanation the moment a failed step is selected,
  // instead of waiting for a click - and always reset stale state from
  // whatever step was previously selected, so switching between two
  // different failures never shows the wrong one.
  useEffect(() => {
    // Resets stale explanation/error from whatever step was previously
    // selected, before deciding whether this step even needs a fetch - not
    // derived state, so it can't move to render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExplanation(null);
    setExplainError(null);
    if (!selection || !isFailure) return;
    let cancelled = false;
    setExplaining(true);
    explainFailure(session.id, selection.laneId, selection.stepIndex)
      .then(({ explanation }) => {
        if (!cancelled) setExplanation(explanation);
      })
      .catch((err: Error) => {
        if (!cancelled) setExplainError(err.message);
      })
      .finally(() => {
        if (!cancelled) setExplaining(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, selection?.laneId, selection?.stepIndex, isFailure]);

  // Failures often bury the real error at the end of a long log - jump
  // straight to it instead of leaving the viewer scrolled to the top.
  useEffect(() => {
    if (isFailure && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [selection?.laneId, selection?.stepIndex, isFailure, effectRecord?.stdout, effectRecord?.stderr]);

  if (!selection || !effectLane) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-600">
        Select a step in the graph to see its output.
      </div>
    );
  }

  const lane = effectLane;
  const job = session.workflow.jobs[lane.jobId];
  const step = job.steps[selection.stepIndex];
  const record = lane.steps[selection.stepIndex];

  async function reAnalyze() {
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
            <span className={`font-semibold ${statusStyle(record.status).textClass}`}>
              {statusStyle(record.status).glyph} {record.status}
            </span>
          )}
          {record.exitCode !== undefined && record.exitCode !== null && <span>exit {record.exitCode}</span>}
          {record.durationMs !== undefined && <span>{record.durationMs}ms</span>}
          {record.continueOnError && <span className="rounded bg-gray-700/50 px-1.5 py-0.5">continue-on-error</span>}
          {record.simulated && <span className="rounded bg-gray-700/50 px-1.5 py-0.5">simulated</span>}
          {record.mockedOutputKeys && record.mockedOutputKeys.length > 0 && (
            <span className="rounded bg-status-breakpoint/20 px-1.5 py-0.5 text-status-breakpoint">
              mocked: {record.mockedOutputKeys.join(", ")}
            </span>
          )}
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
        {record.engineError && (
          <p className="mb-2 rounded border border-status-failure/40 bg-status-failure/10 px-2 py-1 text-xs text-red-300">
            {record.engineError}
          </p>
        )}

        {record.combinedOutput.length > 0 ? (
          <pre
            ref={logRef}
            className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded p-2 font-mono text-xs ${
              record.conclusion === "failure"
                ? "border-l-4 border-status-failure bg-status-failure/5 text-gray-200"
                : "text-gray-300"
            }`}
          >
            {/* Interleaved in arrival order (not two separate stdout/stderr
                blocks) so which line failed relative to the other stream is
                visible, matching what a real terminal would have shown. */}
            {record.combinedOutput.map((chunk, i) =>
              chunk.stream === "stderr" ? (
                <span key={i} className="text-red-300">
                  {chunk.text}
                </span>
              ) : (
                <span key={i}>{chunk.text}</span>
              )
            )}
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

      <div className="space-y-4 overflow-auto p-3">
        {(step.uses || step.run !== undefined) && (
          <MockOutputsEditor
            key={`${lane.jobId}:${step.key}`}
            session={session}
            jobId={lane.jobId}
            stepKey={step.key}
            isRunStep={step.run !== undefined}
            onUpdated={onSessionUpdate}
          />
        )}

        {record.conclusion === "failure" ? (
          <div>
            <button
              onClick={reAnalyze}
              disabled={explaining}
              className="mb-3 rounded-md bg-status-failure/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-status-failure disabled:opacity-50"
            >
              {explaining ? "Analyzing…" : explanation ? "Re-analyze" : "Explain this failure"}
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
          !step.uses && <p className="text-sm text-gray-600">No failure to explain for this step.</p>
        )}
      </div>
    </div>
  );
}
