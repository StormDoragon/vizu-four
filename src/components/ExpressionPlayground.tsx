"use client";

import { useState } from "react";
import { evaluateExpression } from "@/lib/apiClient";
import type { JsonValue } from "@/lib/workflow/types";
import type { TraceNode } from "@/lib/expressions/trace";
import { ExpressionTrace } from "./ExpressionTrace";

export function ExpressionPlayground({
  sessionId,
  laneId,
}: {
  sessionId: string;
  laneId: string | null;
}) {
  const [expr, setExpr] = useState("matrix.node == 18");
  const [result, setResult] = useState<JsonValue | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [errorPosition, setErrorPosition] = useState<number | undefined>();
  const [trace, setTrace] = useState<TraceNode | undefined>();
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(undefined);
    setErrorPosition(undefined);
    setTrace(undefined);
    try {
      const res = await evaluateExpression(expr, sessionId, laneId ?? undefined);
      if (res.error) {
        setError(res.error);
        setErrorPosition(res.errorPosition);
        setResult(undefined);
      } else {
        setResult(res.result ?? null);
      }
      setTrace(res.trace);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-500">
        Evaluate an expression against the active lane&apos;s current context - paste one
        straight from a workflow file, <code>${"{{ }}"}</code> wrapper and all, or write a bare
        one. Secrets in the result are masked, same as everywhere else.
      </p>
      <textarea
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            run();
          }
        }}
        rows={3}
        spellCheck={false}
        className="w-full rounded-md border border-bg-border bg-bg-panel p-2 font-mono text-xs text-ink-100 focus:border-status-running focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={loading}
          title="⌘/Ctrl+Enter"
          className="rounded-md bg-status-running px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Evaluating…" : "Evaluate"}
        </button>
        <span className="text-xs text-ink-600">⌘/Ctrl+Enter</span>
      </div>
      {error && (
        <pre className="whitespace-pre-wrap rounded-md border border-status-failure/40 bg-status-failure/10 p-2 text-xs text-red-300">
          {error}
          {errorPosition !== undefined && (
            <>
              {"\n"}
              {expr}
              {"\n"}
              {" ".repeat(errorPosition)}^
            </>
          )}
        </pre>
      )}
      {!error && result !== undefined && (
        <pre className="whitespace-pre-wrap rounded-md border border-bg-border bg-bg-panel p-2 text-xs text-status-success">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {trace && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-ink-400">Evaluation steps</h4>
          <ExpressionTrace trace={trace} />
        </div>
      )}
    </div>
  );
}
