"use client";

import type { SessionView } from "@/lib/engine/serialize";
import type { ControlAction } from "@/lib/apiClient";

const TERMINAL = new Set(["success", "failure", "skipped"]);

export function TopBar({
  session,
  busy,
  failureCount,
  onControl,
  onToggleBreakOnFailure,
  onJumpToFailure,
  onNewSession,
}: {
  session: SessionView;
  busy: boolean;
  failureCount: number;
  onControl: (action: ControlAction) => void;
  onToggleBreakOnFailure: (v: boolean) => void;
  onJumpToFailure: () => void;
  onNewSession: () => void;
}) {
  const lane = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
  const terminal = !lane || TERMINAL.has(lane.status);
  const blocked = !lane || lane.status === "blocked";
  const canStep = !!lane && !terminal && !blocked && !busy;

  return (
    <div className="flex items-center gap-3 border-b border-bg-border bg-bg-panel px-4 py-2">
      <button onClick={onNewSession} className="text-sm text-gray-400 hover:text-white">
        ← New session
      </button>
      <div className="h-4 w-px bg-bg-border" />
      <span className="text-sm font-semibold text-white">{session.workflow.name ?? "workflow"}</span>
      <div className="h-4 w-px bg-bg-border" />
      <span className="text-xs text-gray-500">
        active lane: {lane ? `${lane.id} (${lane.status})` : "none"}
      </span>

      {failureCount > 0 && (
        <button
          onClick={onJumpToFailure}
          data-testid="jump-to-failure"
          className="rounded-md border border-status-failure/50 bg-status-failure/10 px-3 py-1.5 text-xs font-medium text-status-failure hover:bg-status-failure/20"
        >
          ⚠ {failureCount} failing — jump
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => onControl("step")}
          disabled={!canStep}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-gray-100 hover:border-status-running disabled:opacity-40"
        >
          Step
        </button>
        <button
          onClick={() => onControl("continue")}
          disabled={!canStep}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-gray-100 hover:border-status-running disabled:opacity-40"
        >
          Continue
        </button>
        <button
          onClick={() => onControl("runToEnd")}
          disabled={!canStep}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-gray-100 hover:border-status-running disabled:opacity-40"
        >
          Run to end
        </button>
        <button
          onClick={() => onControl("runAll")}
          disabled={busy}
          className="rounded-md bg-status-running px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          Run all
        </button>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={session.breakOnFailure}
            onChange={(e) => onToggleBreakOnFailure(e.target.checked)}
          />
          pause on failure
        </label>
      </div>
    </div>
  );
}
