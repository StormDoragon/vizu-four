"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyWhatIf,
  control,
  deleteSession,
  getSession,
  setActiveLane,
  setBreakpoint,
  type ControlAction,
} from "@/lib/apiClient";
import type { SessionView } from "@/lib/engine/serialize";
import { TopBar } from "./TopBar";
import { WorkflowGraph } from "./WorkflowGraph";
import { ContextInspector } from "./ContextInspector";
import { MatrixExplorer } from "./MatrixExplorer";
import { ExpressionPlayground } from "./ExpressionPlayground";
import { WhatIfPanel } from "./WhatIfPanel";
import { StepDetailPanel } from "./StepDetailPanel";
import { TimeTravelBar } from "./TimeTravelBar";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { controlAvailability, resolveShortcut } from "./keyboardShortcuts";
import {
  clearPrefs,
  isPristine,
  loadPrefs,
  prefsFromSession,
  restorableBreakpoints,
  savePrefs,
  splitBreakpoint,
} from "@/lib/debugPrefs";
import { findFailures, type Selection } from "./types";
import { focusedLaneLabel } from "./focusLane";

type RightTab = "inspector" | "matrix" | "playground" | "whatif";

const TABS: { id: RightTab; label: string }[] = [
  { id: "inspector", label: "Context" },
  { id: "matrix", label: "Matrix" },
  { id: "playground", label: "Expressions" },
  { id: "whatif", label: "What-If" },
];

export function DebuggerApp({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("inspector");
  const [failureCursor, setFailureCursor] = useState(0);
  const [parseIssuesDismissed, setParseIssuesDismissed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Persistence is only safe to write once a restore has been attempted -
  // otherwise the pristine session that exists before restore would
  // immediately overwrite the stored prefs with empties.
  const [prefsReady, setPrefsReady] = useState(false);
  const [persist, setPersist] = useState(true);
  const [restoredSecretNames, setRestoredSecretNames] = useState<string[]>([]);
  const [restoredNote, setRestoredNote] = useState<string | null>(null);
  const restoreAttempted = useRef<string | null>(null);
  // "Debug this combination only" - purely a client-side view preference
  // (which matrix lane to highlight and steer everything else toward), not
  // engine state, so it isn't persisted and doesn't survive a reload.
  const [focusedLaneId, setFocusedLaneId] = useState<string | null>(null);

  useEffect(() => {
    getSession(sessionId)
      .then((r) => {
        setSession(r.session);
        const failures = findFailures(r.session);
        if (failures.length > 0) {
          setSelection(failures[0]);
        } else if (r.session.activeLaneId) {
          const lane = r.session.lanes[r.session.activeLaneId];
          setSelection({ laneId: lane.id, stepIndex: Math.min(lane.pointer, Math.max(lane.steps.length - 1, 0)) });
        }
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [sessionId]);

  // Bound to the window rather than a focused element so stepping works
  // wherever the pointer happens to be, but only once a session has loaded.
  // resolveShortcut suppresses anything typed into a field or combined with
  // Ctrl/Cmd/Alt, so the browser's own shortcuts still behave normally.
  useEffect(() => {
    if (!session) return;
    const active = session;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      const command = resolveShortcut(event);
      if (!command) return;
      event.preventDefault();
      if (command === "toggleHelp") {
        setHelpOpen((open) => !open);
        return;
      }
      // Same availability rules as the buttons, so a shortcut can never fire
      // an action that would just come back as an engine error banner.
      if (!controlAvailability(active, busy)[command]) return;
      runControl(command);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, busy]);

  // Restore breakpoints and What-If overrides saved for this workflow. Keyed
  // by workflow content rather than session id, so it survives the server
  // restart that drops the in-memory session. Applied only to a pristine
  // session, so a mid-debug reload keeps whatever the server already holds.
  useEffect(() => {
    if (!session) return;
    if (restoreAttempted.current === session.id) return;
    restoreAttempted.current = session.id; // set before any await - no re-entry
    const active = session;

    const prefs = isPristine(active) ? loadPrefs(active.workflowHash) : null;
    if (!prefs) {
      // Nothing to restore - the "ready to persist" gate below still needs
      // flipping, and there's no async work to hang it off of here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefsReady(true);
      return;
    }

    // Deliberately no "cancelled" guard here. The ref above already makes
    // restore run at most once per session, and the server mutations below
    // can't be undone by an unmount - bailing out on cleanup would drop the
    // notice (and the secret names to re-enter) for work that already
    // happened. React's StrictMode double-mount made that misfire every
    // time in dev; setState on an unmounted component is a harmless no-op.
    (async () => {
      try {
        let latest = active;
        const breakpoints = restorableBreakpoints(prefs, active);
        for (const breakpoint of breakpoints) {
          const parts = splitBreakpoint(breakpoint);
          if (!parts) continue;
          latest = (await setBreakpoint(active.id, parts.jobId, parts.stepKey, true)).session;
        }

        const envCount = Object.keys(prefs.envOverrides).length;
        const varCount = Object.keys(prefs.vars).length;
        if (envCount > 0 || varCount > 0 || prefs.breakOnFailure !== active.breakOnFailure) {
          latest = (
            await applyWhatIf(active.id, {
              env: prefs.envOverrides,
              vars: prefs.vars,
              breakOnFailure: prefs.breakOnFailure,
            })
          ).session;
        }

        setSession(latest);
        setRestoredSecretNames(prefs.secretNames);

        const restored: string[] = [];
        if (breakpoints.length > 0) {
          restored.push(`${breakpoints.length} breakpoint${breakpoints.length === 1 ? "" : "s"}`);
        }
        if (envCount > 0) restored.push(`${envCount} env override${envCount === 1 ? "" : "s"}`);
        if (varCount > 0) restored.push(`${varCount} var${varCount === 1 ? "" : "s"}`);
        if (restored.length > 0 || prefs.secretNames.length > 0) {
          const secretNote =
            prefs.secretNames.length > 0
              ? ` Secret values are never saved — re-enter ${prefs.secretNames.join(", ")} in What-If.`
              : "";
          const head = restored.length > 0 ? `Restored ${restored.join(", ")}.` : "";
          setRestoredNote(`${head}${secretNote}`.trim());
        }
      } catch {
        // Best-effort: a failed restore must not block debugging.
      } finally {
        setPrefsReady(true);
      }
    })();
  }, [session]);

  // Mirror the server's state back into storage after every mutation.
  useEffect(() => {
    if (!session || !prefsReady || !persist) return;
    savePrefs(session.workflowHash, prefsFromSession(session));
  }, [session, prefsReady, persist]);

  /**
   * A plain "forget" button would be undone by the very next mutation, since
   * the mirror above would just write the live state straight back. Making
   * it a toggle keeps the contract honest: off means cleared *and* not
   * recorded again.
   */
  function togglePersist(next: boolean) {
    if (!session) return;
    setPersist(next);
    if (next) {
      savePrefs(session.workflowHash, prefsFromSession(session));
      setRestoredNote("Now remembering this workflow's breakpoints and What-If overrides.");
    } else {
      clearPrefs(session.workflowHash);
      setRestoredSecretNames([]);
      setRestoredNote("Saved state for this workflow cleared.");
    }
  }

  async function runControl(action: ControlAction) {
    if (!session) return;
    setBusy(true);
    setActionError(null);
    const laneId = session.activeLaneId ?? undefined;
    try {
      const { session: updated } = await control(session.id, action, laneId);
      setSession(updated);
      setSelection(pickPostControlSelection(updated, laneId ?? null));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * After executing anything, prefer landing on a failure: the active
   * lane's own, if it just failed, else the first failure anywhere (e.g.
   * "Run all" can fail a matrix lane other than the active one). Falls back
   * to the previous "select whatever just ran" behavior when nothing failed.
   */
  function pickPostControlSelection(updated: SessionView, laneId: string | null): Selection | null {
    if (laneId) {
      const lane = updated.lanes[laneId];
      const idx = Math.max(0, Math.min(lane.pointer, lane.steps.length - 1));
      if (lane.steps[idx]?.conclusion === "failure") {
        return { laneId, stepIndex: idx };
      }
    }
    const failures = findFailures(updated);
    if (failures.length > 0) return failures[0];
    if (laneId) {
      const lane = updated.lanes[laneId];
      const idx = Math.max(0, Math.min(lane.pointer, lane.steps.length - 1));
      return { laneId, stepIndex: idx };
    }
    return null;
  }

  async function jumpToFailure() {
    if (!session) return;
    const failures = findFailures(session);
    if (failures.length === 0) return;
    const target = failures[failureCursor % failures.length];
    setFailureCursor((c) => (c + 1) % failures.length);
    if (target.laneId !== session.activeLaneId) {
      try {
        const { session: updated } = await setActiveLane(session.id, target.laneId);
        setSession(updated);
      } catch (err) {
        setActionError((err as Error).message);
        return;
      }
    }
    setSelection(target);
  }

  async function onSelectLane(laneId: string) {
    if (!session) return;
    try {
      const { session: updated } = await setActiveLane(session.id, laneId);
      setSession(updated);
      const lane = updated.lanes[laneId];
      setSelection({ laneId, stepIndex: Math.max(0, Math.min(lane.pointer, lane.steps.length - 1)) });
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  /**
   * "Debug this combination only": pressing it a second time on the same
   * lane clears focus rather than re-focusing it, so the same control
   * doubles as the "Show all combinations" action. Focusing a lane also
   * makes it the steppable one, since focus without switching Step/Continue
   * onto that lane wouldn't actually let you debug it.
   */
  async function onToggleFocus(laneId: string) {
    if (focusedLaneId === laneId) {
      setFocusedLaneId(null);
      return;
    }
    setFocusedLaneId(laneId);
    if (session?.activeLaneId !== laneId) {
      await onSelectLane(laneId);
    }
  }

  async function onToggleBreakpoint(jobId: string, stepKey: string, enabled: boolean) {
    if (!session) return;
    try {
      const { session: updated } = await setBreakpoint(session.id, jobId, stepKey, enabled);
      setSession(updated);
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function onToggleBreakOnFailure(v: boolean) {
    if (!session) return;
    const { session: updated } = await applyWhatIf(session.id, { breakOnFailure: v });
    setSession(updated);
  }

  function onNewSession() {
    // Best-effort: reclaim this session's workspace dir immediately rather
    // than leaving it for the idle reaper. Navigate regardless of outcome.
    if (session) deleteSession(session.id).catch(() => {});
    router.push("/");
  }

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-red-400">
        {loadError}
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-ink-500">
        Loading session…
      </div>
    );
  }

  const activeLane = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
  const inspectorLaneId = selection?.laneId ?? session.activeLaneId ?? null;
  // Context as of right after the selected step finished, so its own
  // outputs show up in `steps.*` - not always the lane's current pointer,
  // which is "the next step to run", not "the step the user clicked".
  const inspectorStepIndex = selection
    ? selection.stepIndex + 1
    : (inspectorLaneId ? session.lanes[inspectorLaneId]?.pointer : undefined);
  const focusedLabel = focusedLaneId ? focusedLaneLabel(session, focusedLaneId) : null;

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        session={session}
        busy={busy}
        failureCount={findFailures(session).length}
        onControl={runControl}
        onToggleBreakOnFailure={onToggleBreakOnFailure}
        onJumpToFailure={jumpToFailure}
        onNewSession={onNewSession}
        onToggleHelp={() => setHelpOpen((open) => !open)}
        focusedLabel={focusedLabel}
        onClearFocus={() => setFocusedLaneId(null)}
      />
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      {actionError && (
        <div className="border-b border-status-failure/40 bg-status-failure/10 px-4 py-1.5 text-xs text-red-300">
          {actionError}
        </div>
      )}
      {activeLane?.jobIfWarning && (
        <div className="border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 text-xs text-yellow-300">
          ⚠ {activeLane.jobIfWarning}
        </div>
      )}
      {session.simulationOnly && (
        <div className="border-b border-status-running/30 bg-status-running/10 px-4 py-1.5 text-xs text-blue-200">
          <strong>Simulation-only.</strong> This deployment does not execute{" "}
          <code>run:</code> steps — by default they report success without running, showing the
          interpolated command instead. Mock a step to give it outputs or make it fail.
          Everything else (expressions, matrix, <code>if:</code> conditions, breakpoints)
          behaves normally. Run it locally to execute for real.
        </div>
      )}
      {session.usesRealWorkspace && (
        <div className="border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 text-xs text-yellow-200">
          <strong>Real working tree.</strong> Unmocked <code>run:</code> steps in this session
          execute for real against files on this machine — not a disposable scratch copy. Ending
          this session will not delete that directory, but the steps you run against it can.
        </div>
      )}
      {restoredNote && (
        <div className="flex items-start gap-2 border-b border-bg-border bg-bg-raised px-4 py-1.5 text-xs text-ink-400">
          <span className="flex-1" data-testid="restored-note">
            {restoredNote}
          </span>
          <button
            onClick={() => setRestoredNote(null)}
            className="shrink-0 text-ink-500 hover:text-ink-200"
            aria-label="Dismiss restore notice"
          >
            ✕
          </button>
        </div>
      )}
      {!parseIssuesDismissed && session.parseIssues.length > 0 && (
        <div className="flex items-start gap-2 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 text-xs text-yellow-300">
          <ul className="flex-1 space-y-0.5">
            {session.parseIssues.map((issue, i) => (
              <li key={i}>⚠ {issue.message}</li>
            ))}
          </ul>
          <button
            onClick={() => setParseIssuesDismissed(true)}
            className="shrink-0 text-yellow-400 hover:text-yellow-200"
            aria-label="Dismiss parse warnings"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="min-h-[280px] flex-1 overflow-hidden">
          <WorkflowGraph
            session={session}
            selection={selection}
            busy={busy}
            focusedLaneId={focusedLaneId}
            onSelectStep={setSelection}
            onToggleBreakpoint={onToggleBreakpoint}
            onSelectLane={onSelectLane}
            onToggleFocus={onToggleFocus}
          />
        </div>

        <div className="flex h-72 w-full flex-col overflow-hidden border-t border-bg-border lg:h-auto lg:w-[380px] lg:border-l lg:border-t-0">
          <div className="flex border-b border-bg-border">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={`flex-1 px-2 py-2 text-xs font-medium ${
                  rightTab === tab.id
                    ? "border-b-2 border-status-running text-ink"
                    : "text-ink-500 hover:text-ink-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-3">
            {rightTab === "inspector" && (
              <ContextInspector
                sessionId={session.id}
                laneId={inspectorLaneId}
                stepIndex={inspectorStepIndex}
                revision={session.revision}
              />
            )}
            {rightTab === "matrix" && (
              <MatrixExplorer
                session={session}
                selectedLaneId={inspectorLaneId}
                onSelectLane={onSelectLane}
                focusedLaneId={focusedLaneId}
                onToggleFocus={onToggleFocus}
              />
            )}
            {rightTab === "playground" && (
              <ExpressionPlayground sessionId={session.id} laneId={inspectorLaneId} />
            )}
            {rightTab === "whatif" && (
              <WhatIfPanel
                session={session}
                onApplied={setSession}
                suggestedSecretNames={restoredSecretNames}
                persist={persist}
                onTogglePersist={togglePersist}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex h-[28rem] flex-col border-t border-bg-border lg:h-80">
        <TimeTravelBar session={session} selection={selection} onSelect={setSelection} />
        <div className="flex-1 overflow-hidden">
          <StepDetailPanel session={session} selection={selection} onSessionUpdate={setSession} />
        </div>
      </div>
    </div>
  );
}
