"use client";

import { useEffect, useState } from "react";
import { getContext } from "@/lib/apiClient";
import type { JsonValue } from "@/lib/workflow/types";

const SECTION_ORDER = [
  "github",
  "env",
  "vars",
  "secrets",
  "matrix",
  "needs",
  "steps",
  "runner",
  "job",
  "inputs",
  "strategy",
];
const OPEN_BY_DEFAULT = new Set(["matrix", "env", "steps"]);

export function ContextInspector({
  sessionId,
  laneId,
  refreshKey,
}: {
  sessionId: string;
  laneId: string | null;
  refreshKey: number;
}) {
  const [context, setContext] = useState<Record<string, JsonValue> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!laneId) {
      setContext(null);
      return;
    }
    let cancelled = false;
    getContext(sessionId, laneId)
      .then((r) => {
        if (!cancelled) setContext(r.context);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, laneId, refreshKey]);

  if (!laneId) return <p className="text-sm text-gray-500">No active lane selected yet.</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!context) return <p className="text-sm text-gray-500">Loading…</p>;

  const keys = [
    ...SECTION_ORDER.filter((k) => k in context),
    ...Object.keys(context).filter((k) => !SECTION_ORDER.includes(k)),
  ];

  return (
    <div className="space-y-2">
      {keys.map((key) => (
        <details
          key={key}
          open={OPEN_BY_DEFAULT.has(key)}
          className="rounded-md border border-bg-border bg-bg-panel"
        >
          <summary className="cursor-pointer select-none px-2 py-1.5 text-sm font-medium text-gray-200">
            {key}
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-bg-border px-2 py-2 text-xs text-gray-300">
            {JSON.stringify(context[key], null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}
