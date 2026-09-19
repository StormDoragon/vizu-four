"use client";

import type { SessionView } from "@/lib/engine/serialize";
import type { ControlAction } from "@/lib/apiClient";
import { controlAvailability, shortcutHint } from "./keyboardShortcuts";

export function TopBar({
  session,
  busy,
  failureCount,
  onControl,
  onToggleBreakOnFailure,
  onJumpToFailure,
  onNewSession,
  onToggleHelp,
}: {
  session: SessionView;
  busy: boolean;
  failureCount: number;
  onControl: (action: ControlAction) => void;
  onToggleBreakOnFailure: (v: boolean) => void;
  onJumpToFailure: () => void;
  onNewSession: () => void;
  onToggleHelp: () => void;
}) {
  const lane = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
  const can = controlAvailability(session, busy);

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
          disabled={!can.step}
          title={`Step (${shortcutHint("step")})`}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-gray-100 hover:border-status-running disabled:opacity-40"
        >
          Step
        </button>
        <button
          onClick={() => onControl("continue")}
          disabled={!can.continue}
          title={`Continue (${shortcutHint("continue")})`}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-gray-100 hover:border-status-running disabled:opacity-40"
        >
          Continue
        </button>
        <button
          onClick={() => onControl("runToEnd")}
          disabled={!can.runToEnd}
          title={`Run to end (${shortcutHint("runToEnd")})`}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-gray-100 hover:border-status-running disabled:opacity-40"
        >
          Run to end
        </button>
        <button
          onClick={() => onControl("runAll")}
          disabled={!can.runAll}
          title={`Run all (${shortcutHint("runAll")})`}
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
        <button
          onClick={onToggleHelp}
          data-testid="shortcuts-help-toggle"
          title={`Keyboard shortcuts (${shortcutHint("toggleHelp")})`}
          aria-label="Keyboard shortcuts"
          className="rounded-md border border-bg-border bg-bg-raised px-2 py-1.5 text-xs font-medium text-gray-400 hover:border-status-running hover:text-gray-100"
        >
          ?
        </button>
      </div>
    </div>
  );
}
