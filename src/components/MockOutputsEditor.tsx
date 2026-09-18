"use client";

import { useState } from "react";
import { setMockOutputs } from "@/lib/apiClient";
import type { SessionView } from "@/lib/engine/serialize";
import { KeyValueEditor, rowsToRecord, type KeyValueRow } from "./KeyValueEditor";

/**
 * Lets a user stub the outputs of a `uses:` step. Render with a `key` of
 * `${jobId}:${stepKey}` from the parent so React remounts (and re-reads the
 * saved mock) when the selected step changes, rather than carrying stale
 * row state from whatever step was selected before.
 */
export function MockOutputsEditor({
  session,
  jobId,
  stepKey,
  onUpdated,
}: {
  session: SessionView;
  jobId: string;
  stepKey: string;
  onUpdated: (s: SessionView) => void;
}) {
  const existing = session.mockOutputs[`${jobId}:${stepKey}`] ?? {};
  const [rows, setRows] = useState<KeyValueRow[]>(
    Object.entries(existing).map(([key, value]) => ({ key, value }))
  );
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const hasMocks = Object.keys(existing).length > 0;

  async function apply() {
    setApplying(true);
    setMessage(null);
    try {
      const record = rowsToRecord(rows);
      const { session: updated } = await setMockOutputs(
        session.id,
        jobId,
        stepKey,
        Object.keys(record).length > 0 ? record : null
      );
      onUpdated(updated);
      setMessage("Applied — takes effect next time this step runs.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function clearAll() {
    setApplying(true);
    setMessage(null);
    try {
      const { session: updated } = await setMockOutputs(session.id, jobId, stepKey, null);
      setRows([]);
      onUpdated(updated);
      setMessage("Mocks cleared.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="rounded-md border border-bg-border bg-bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-200">Mock outputs</h4>
        {hasMocks && (
          <span className="rounded bg-status-breakpoint/20 px-1.5 py-0.5 text-[10px] uppercase text-status-breakpoint">
            active
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-gray-500">
        Stub this step&apos;s outputs so downstream steps see the values you choose instead of
        whatever the simulator produces.
      </p>
      <KeyValueEditor testId="mock" title="Outputs" rows={rows} setRows={setRows} />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={apply}
          disabled={applying}
          data-testid="mock-apply"
          className="rounded-md bg-status-running px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {applying ? "Applying…" : "Apply"}
        </button>
        {hasMocks && (
          <button
            onClick={clearAll}
            disabled={applying}
            className="rounded-md border border-bg-border px-3 py-1.5 text-xs text-gray-300 hover:border-red-400 hover:text-red-400 disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>
      {message && <p className="mt-2 text-xs text-gray-400">{message}</p>}
    </div>
  );
}
