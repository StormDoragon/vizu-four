"use client";

import { useState } from "react";
import { applyWhatIf } from "@/lib/apiClient";
import type { SessionView } from "@/lib/engine/serialize";
import { KeyValueEditor, rowsToRecord, type KeyValueRow } from "./KeyValueEditor";

export function WhatIfPanel({
  session,
  onApplied,
}: {
  session: SessionView;
  onApplied: (s: SessionView) => void;
}) {
  const [envRows, setEnvRows] = useState<KeyValueRow[]>(
    Object.entries(session.config.envOverrides).map(([key, value]) => ({ key, value }))
  );
  const [varRows, setVarRows] = useState<KeyValueRow[]>(
    Object.entries(session.config.vars).map(([key, value]) => ({ key, value }))
  );
  const [secretRows, setSecretRows] = useState<KeyValueRow[]>(
    session.config.secretNames.map((key) => ({ key, value: "" }))
  );
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Diffs current rows against what was loaded, emitting `null` for keys
   * that were removed - a plain `rowsToRecord` only ever produces keys that
   * are still present, so a deleted row could never actually clear the
   * override on the session; it would just stop being resent. */
  function buildKeyedPatch(
    initialKeys: string[],
    rows: KeyValueRow[]
  ): Record<string, string | null> {
    const current = rowsToRecord(rows);
    const patch: Record<string, string | null> = { ...current };
    for (const key of initialKeys) {
      if (!(key in current)) patch[key] = null;
    }
    return patch;
  }

  async function apply() {
    setApplying(true);
    setMessage(null);
    try {
      const patch: {
        env?: Record<string, string | null>;
        vars?: Record<string, string | null>;
        secrets?: Record<string, string | null>;
      } = {};
      const env = buildKeyedPatch(Object.keys(session.config.envOverrides), envRows);
      if (Object.keys(env).length > 0) patch.env = env;
      const vars = buildKeyedPatch(Object.keys(session.config.vars), varRows);
      if (Object.keys(vars).length > 0) patch.vars = vars;

      // Secrets never come back from the server once set, so a blank value
      // means "leave as-is" rather than "clear" - only an outright removed
      // row counts as a deletion.
      const secrets: Record<string, string | null> = {};
      for (const row of secretRows) {
        const key = row.key.trim();
        if (key && row.value !== "") secrets[key] = row.value;
      }
      const currentSecretKeys = new Set(
        secretRows.map((r) => r.key.trim()).filter(Boolean)
      );
      for (const key of session.config.secretNames) {
        if (!currentSecretKeys.has(key)) secrets[key] = null;
      }
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
