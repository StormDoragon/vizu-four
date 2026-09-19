"use client";

import { useState } from "react";
import { setMockOutputs } from "@/lib/apiClient";
import type { SessionView } from "@/lib/engine/serialize";
import { KeyValueEditor, rowsToRecord, type KeyValueRow } from "./KeyValueEditor";

const DEFAULT_EXIT_CODE = "1";

/**
 * Lets a user stub a step's result: its outputs, and — for the failure paths
 * that are otherwise hard to reach — its exit code and stderr. Render with a
 * `key` of `${jobId}:${stepKey}` from the parent so React remounts (and
 * re-reads the saved mock) when the selected step changes, rather than
 * carrying stale row state from whatever step was selected before.
 */
export function MockOutputsEditor({
  session,
  jobId,
  stepKey,
  isRunStep,
  onUpdated,
}: {
  session: SessionView;
  jobId: string;
  stepKey: string;
  /** `run:` steps are normally executed, so a mock means something stronger
   * for them than for `uses:` steps: it replaces the execution entirely. */
  isRunStep: boolean;
  onUpdated: (s: SessionView) => void;
}) {
  const existing = session.mockOutputs[`${jobId}:${stepKey}`];
  const [rows, setRows] = useState<KeyValueRow[]>(
    Object.entries(existing?.outputs ?? {}).map(([key, value]) => ({ key, value }))
  );
  const [fails, setFails] = useState(existing?.exitCode !== undefined && existing.exitCode !== 0);
  const [exitCode, setExitCode] = useState(
    existing?.exitCode !== undefined ? String(existing.exitCode) : DEFAULT_EXIT_CODE
  );
  const [stderr, setStderr] = useState(existing?.stderr ?? "");
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const hasMocks = !!existing;

  async function apply() {
    setApplying(true);
    setMessage(null);
    try {
      const outputs = rowsToRecord(rows);
      const parsedExit = Number.parseInt(exitCode, 10);
      if (fails && (!Number.isInteger(parsedExit) || parsedExit < 1 || parsedExit > 255)) {
        setMessage("Exit code must be a whole number between 1 and 255.");
        return;
      }
      const { session: updated } = await setMockOutputs(session.id, jobId, stepKey, {
        outputs,
        exitCode: fails ? parsedExit : undefined,
        stderr: fails ? stderr.trim() || undefined : undefined,
      });
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
      setFails(false);
      setExitCode(DEFAULT_EXIT_CODE);
      setStderr("");
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
        <h4 className="text-xs font-semibold text-gray-200">Mock this step</h4>
        {hasMocks && (
          <span className="rounded bg-status-breakpoint/20 px-1.5 py-0.5 text-[10px] uppercase text-status-breakpoint">
            active
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-gray-500">
        {isRunStep
          ? "A mocked step is not executed — the values below decide its result, so you can drive downstream steps and the failure paths without running anything."
          : "Stub this step's outputs so downstream steps see the values you choose instead of whatever the simulator produces."}
      </p>
      <KeyValueEditor testId="mock" title="Outputs" rows={rows} setRows={setRows} />

      <div className="mt-3 border-t border-bg-border pt-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={fails}
            onChange={(e) => setFails(e.target.checked)}
            data-testid="mock-fails"
            className="accent-status-failure"
          />
          Make this step fail
        </label>
        {fails && (
          <div className="mt-2 space-y-2">
            <label className="block text-[11px] text-gray-500">
              Exit code
              <input
                type="number"
                min={1}
                max={255}
                value={exitCode}
                onChange={(e) => setExitCode(e.target.value)}
                data-testid="mock-exit-code"
                className="mt-1 block w-24 rounded border border-bg-border bg-bg-raised px-2 py-1 text-xs text-gray-200"
              />
            </label>
            <label className="block text-[11px] text-gray-500">
              stderr
              <textarea
                value={stderr}
                onChange={(e) => setStderr(e.target.value)}
                rows={3}
                placeholder="error: something went wrong"
                data-testid="mock-stderr"
                className="mt-1 block w-full rounded border border-bg-border bg-bg-raised px-2 py-1 font-mono text-xs text-gray-200"
              />
            </label>
            <p className="text-[11px] text-gray-600">
              A non-zero exit code is what exercises <code>continue-on-error</code>,{" "}
              <code>if: failure()</code> and the failure explanation panel.
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
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
            data-testid="mock-clear"
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
