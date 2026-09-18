"use client";

import { useState } from "react";
import { applyWhatIf } from "@/lib/apiClient";
import type { SessionView } from "@/lib/engine/serialize";

interface Row {
  key: string;
  value: string;
}

function KeyValueEditor({
  testId,
  title,
  rows,
  setRows,
}: {
  testId: string;
  title: string;
  rows: Row[];
  setRows: (r: Row[]) => void;
}) {
  return (
    <div data-testid={`whatif-section-${testId}`}>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
        <button
          onClick={() => setRows([...rows, { key: "", value: "" }])}
          data-testid={`whatif-add-${testId}`}
          className="text-xs text-status-running hover:underline"
        >
          + add
        </button>
      </div>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1">
            <input
              value={row.key}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
              placeholder="KEY"
              data-testid={`whatif-${testId}-key-${i}`}
              className="w-1/3 rounded border border-bg-border bg-bg-panel px-2 py-1 text-xs text-gray-100 focus:border-status-running focus:outline-none"
            />
            <input
              value={row.value}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
              placeholder="value"
              data-testid={`whatif-${testId}-value-${i}`}
              className="flex-1 rounded border border-bg-border bg-bg-panel px-2 py-1 text-xs text-gray-100 focus:border-status-running focus:outline-none"
            />
            <button
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="px-1 text-xs text-gray-500 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs italic text-gray-600">none</p>}
      </div>
    </div>
  );
}

export function WhatIfPanel({
  session,
  onApplied,
}: {
  session: SessionView;
  onApplied: (s: SessionView) => void;
}) {
  const [envRows, setEnvRows] = useState<Row[]>(
    Object.entries(session.config.envOverrides).map(([key, value]) => ({ key, value }))
  );
  const [varRows, setVarRows] = useState<Row[]>(
    Object.entries(session.config.vars).map(([key, value]) => ({ key, value }))
  );
  const [secretRows, setSecretRows] = useState<Row[]>(
    session.config.secretNames.map((key) => ({ key, value: "" }))
  );
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toRecord(rows: Row[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value;
    return out;
  }

  async function apply() {
    setApplying(true);
    setMessage(null);
    try {
      const patch: { env?: Record<string, string>; vars?: Record<string, string>; secrets?: Record<string, string> } = {};
      const env = toRecord(envRows);
      if (Object.keys(env).length > 0) patch.env = env;
      const vars = toRecord(varRows);
      if (Object.keys(vars).length > 0) patch.vars = vars;
      const secrets = toRecord(secretRows.filter((r) => r.value !== ""));
      if (Object.keys(secrets).length > 0) patch.secrets = secrets;

      const { session: updated } = await applyWhatIf(session.id, patch);
      onApplied(updated);
      setMessage("Applied — takes effect on the next step you run.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Override env vars, vars, or provide local secret values without touching the workflow
        file or pushing a commit. Nothing here is saved to disk.
      </p>
      <KeyValueEditor testId="env" title="Env overrides" rows={envRows} setRows={setEnvRows} />
      <KeyValueEditor testId="vars" title="Vars" rows={varRows} setRows={setVarRows} />
      <KeyValueEditor testId="secrets" title="Secrets (local only)" rows={secretRows} setRows={setSecretRows} />
      <button
        onClick={apply}
        disabled={applying}
        data-testid="whatif-apply"
        className="rounded-md bg-status-running px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {applying ? "Applying…" : "Apply"}
      </button>
      {message && <p className="text-xs text-gray-400">{message}</p>}
    </div>
  );
}
