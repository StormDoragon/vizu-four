"use client";

import { useState } from "react";
import { evaluateExpression } from "@/lib/apiClient";
import type { JsonValue } from "@/lib/workflow/types";
import type { TraceNode } from "@/lib/expressions/trace";
import { ExpressionTrace } from "./ExpressionTrace";

/**
 * The line of `text` that `position` falls on, with a caret under that
 * column. Drawing the whole text with the caret on a line after it put the
 * caret under nothing for any expression spanning more than one line.
 */
function caretUnder(text: string, position: number): string {
  const lineStart = position === 0 ? 0 : text.lastIndexOf("\n", position - 1) + 1;
  const lineEnd = text.indexOf("\n", position);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  return `${line}\n${" ".repeat(position - lineStart)}^`;
}

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
  // The text the shown result belongs to. The caret is drawn under this, not
  // under the textarea - which may have been edited since, leaving a
  // position from one expression pointing into another.
  const [evaluated, setEvaluated] = useState("");

  async function run() {
    // ⌘/Ctrl+Enter reaches here even while the button is disabled, and two
    // requests in flight can answer out of order.
    if (loading) return;
    const source = expr;
    setLoading(true);
    setError(undefined);
    setErrorPosition(undefined);
    setTrace(undefined);
    try {
      const res = await evaluateExpression(source, sessionId, laneId ?? undefined);
      setEvaluated(source);
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
        <pre
          data-testid="expression-error"
          className="whitespace-pre-wrap rounded-md border border-status-failure/40 bg-status-failure/10 p-2 text-xs text-red-300"
        >
          {error}
          {errorPosition !== undefined && `\n${caretUnder(evaluated, errorPosition)}`}
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
