"use client";

import type { SessionView } from "@/lib/engine/serialize";
import type { ControlAction } from "@/lib/apiClient";
import { controlAvailability, shortcutHint } from "./keyboardShortcuts";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar({
  session,
  busy,
  failureCount,
  onControl,
  onToggleBreakOnFailure,
  onJumpToFailure,
  onNewSession,
  onToggleHelp,
  onShare,
  focusedLabel,
  onClearFocus,
}: {
  session: SessionView;
  busy: boolean;
  failureCount: number;
  onControl: (action: ControlAction) => void;
  onToggleBreakOnFailure: (v: boolean) => void;
  onJumpToFailure: () => void;
  onNewSession: () => void;
  onToggleHelp: () => void;
  onShare: () => void;
  /** "<job> — <combo>" for the lane "Debug this combination only" is
   * focused on, or null when nothing's focused - shown here so focus is
   * unambiguous without having to open the Matrix tab to check. */
  focusedLabel: string | null;
  onClearFocus: () => void;
}) {
  const lane = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
  const can = controlAvailability(session, busy);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-bg-border bg-bg-panel px-4 py-2">
      <button onClick={onNewSession} className="text-sm text-ink-400 hover:text-ink">
        ← New session
      </button>
      <div className="hidden h-4 w-px bg-bg-border sm:block" />
      <span className="text-sm font-semibold text-ink">{session.workflow.name ?? "workflow"}</span>
      <div className="hidden h-4 w-px bg-bg-border sm:block" />
      <span className="hidden text-xs text-ink-500 sm:inline">
        active lane: {lane ? `${lane.id} (${lane.status})` : "none"}
      </span>

      {focusedLabel && (
        <button
          onClick={onClearFocus}
          data-testid="focused-lane-badge"
          title="Debugging this combination only - click to show all combinations"
          className="flex max-w-[16rem] items-center gap-1 rounded-md border border-status-breakpoint/50 bg-status-breakpoint/10 px-3 py-1.5 text-xs font-medium text-status-breakpoint hover:bg-status-breakpoint/20"
        >
          🎯 <span className="truncate">{focusedLabel}</span> ✕
        </button>
      )}

      {failureCount > 0 && (
        <button
          onClick={onJumpToFailure}
          data-testid="jump-to-failure"
          className="rounded-md border border-status-failure/50 bg-status-failure/10 px-3 py-1.5 text-xs font-medium text-status-failure hover:bg-status-failure/20"
        >
          ⚠ {failureCount} failing — jump
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <button
          onClick={() => onControl("step")}
          disabled={!can.step}
          title={`Step (${shortcutHint("step")})`}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-ink-100 hover:border-status-running disabled:opacity-40"
        >
          Step
        </button>
        <button
          onClick={() => onControl("continue")}
          disabled={!can.continue}
          title={`Continue (${shortcutHint("continue")})`}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-ink-100 hover:border-status-running disabled:opacity-40"
        >
          Continue
        </button>
        <button
          onClick={() => onControl("runToEnd")}
          disabled={!can.runToEnd}
          title={`Run to end (${shortcutHint("runToEnd")})`}
          className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-xs font-medium text-ink-100 hover:border-status-running disabled:opacity-40"
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
        <label className="ml-2 flex items-center gap-1.5 text-xs text-ink-400">
          <input
            type="checkbox"
            checked={session.breakOnFailure}
            onChange={(e) => onToggleBreakOnFailure(e.target.checked)}
          />
          pause on failure
        </label>
        <button
          onClick={onShare}
          data-testid="share-toggle"
          title="Share this session"
          aria-label="Share this session"
          className="rounded-md border border-bg-border bg-bg-raised px-2 py-1.5 text-xs font-medium text-ink-400 hover:border-status-running hover:text-ink-100"
        >
          🔗
        </button>
        <button
          onClick={onToggleHelp}
          data-testid="shortcuts-help-toggle"
          title={`Keyboard shortcuts (${shortcutHint("toggleHelp")})`}
          aria-label="Keyboard shortcuts"
          className="rounded-md border border-bg-border bg-bg-raised px-2 py-1.5 text-xs font-medium text-ink-400 hover:border-status-running hover:text-ink-100"
        >
          ?
        </button>
        <ThemeToggle />
      </div>
    </div>
  );
}
