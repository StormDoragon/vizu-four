import type { JsonValue } from "@/lib/workflow/types";
import type { TraceNode } from "@/lib/expressions/trace";

function formatValue(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return `'${value}'`;
  return JSON.stringify(value);
}

/** One sub-expression's row, plus its children indented beneath it - a
 * step-by-step breakdown of how the whole expression evaluated, not just
 * its final result (#9). Recurses depth-first in the same order the
 * expression was actually evaluated in. */
function TraceRow({ node, depth }: { node: TraceNode; depth: number }) {
  const isRoot = depth === 0;

  return (
    <div className={isRoot ? "" : "ml-3 border-l border-bg-border pl-3"}>
      <div
        className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-1 py-0.5 ${
          node.causedError
            ? "bg-status-failure/10"
            : node.error
              ? "bg-status-failure/5"
              : ""
        }`}
      >
        <code className="text-ink-200">{node.source}</code>
        {!node.skipped && !node.error && (
          <>
            <span className="text-ink-600">→</span>
            <code className="text-status-success">{formatValue(node.value ?? null)}</code>
          </>
        )}
        {node.skipped && (
          <span className="italic text-ink-600">not evaluated — short-circuited</span>
        )}
        {node.causedError && <span className="text-red-300">✕ {node.error}</span>}
        {node.error && !node.causedError && (
          <span className="text-status-failure/70">↳ failed below</span>
        )}
        {node.contextRef && (
          <span
            className="rounded bg-status-running/10 px-1 py-0 text-[10px] text-status-running"
            title="References this context value"
          >
            {node.contextRef}
          </span>
        )}
      </div>
      {node.coercion && (
        <p className="pl-1 text-[11px] italic text-ink-500" data-testid="trace-coercion">
          ⚠ {node.coercion}
        </p>
      )}
      {node.children.map((child, i) => (
        <TraceRow key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ExpressionTrace({ trace }: { trace: TraceNode }) {
  return (
    <div className="space-y-1 rounded-md border border-bg-border bg-bg-panel p-2 font-mono text-xs" data-testid="expression-trace">
      <TraceRow node={trace} depth={0} />
    </div>
  );
}
