"use client";

import { useEffect, useState } from "react";
import {
  applyWhatIf,
  control,
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
import { findFailures, type Selection } from "./types";

type RightTab = "inspector" | "matrix" | "playground" | "whatif";

const TABS: { id: RightTab; label: string }[] = [
  { id: "inspector", label: "Context" },
  { id: "matrix", label: "Matrix" },
  { id: "playground", label: "Expressions" },
  { id: "whatif", label: "What-If" },
];

export function DebuggerApp({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("inspector");
  const [failureCursor, setFailureCursor] = useState(0);

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

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-red-400">
        {loadError}
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">
        Loading session…
      </div>
    );
  }

  const activeLane = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
  const inspectorLaneId = selection?.laneId ?? session.activeLaneId ?? null;
  const inspectorRefreshKey = inspectorLaneId
    ? (session.lanes[inspectorLaneId]?.pointer ?? 0) +
      (session.lanes[inspectorLaneId]?.steps.length ?? 0) * 1000
    : 0;

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        session={session}
        busy={busy}
        failureCount={findFailures(session).length}
        onControl={runControl}
        onToggleBreakOnFailure={onToggleBreakOnFailure}
        onJumpToFailure={jumpToFailure}
      />
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

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <WorkflowGraph
            session={session}
            selection={selection}
            onSelectStep={setSelection}
            onToggleBreakpoint={onToggleBreakpoint}
            onSelectLane={onSelectLane}
          />
        </div>

        <div className="flex w-[380px] flex-col overflow-hidden border-l border-bg-border">
          <div className="flex border-b border-bg-border">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={`flex-1 px-2 py-2 text-xs font-medium ${
                  rightTab === tab.id
                    ? "border-b-2 border-status-running text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-3">
            {rightTab === "inspector" && (
              <ContextInspector sessionId={session.id} laneId={inspectorLaneId} refreshKey={inspectorRefreshKey} />
            )}
            {rightTab === "matrix" && <MatrixExplorer session={session} onSelectLane={onSelectLane} />}
            {rightTab === "playground" && (
              <ExpressionPlayground sessionId={session.id} laneId={inspectorLaneId} />
            )}
            {rightTab === "whatif" && <WhatIfPanel session={session} onApplied={setSession} />}
          </div>
        </div>
      </div>

      <div className="h-72 border-t border-bg-border">
        <StepDetailPanel session={session} selection={selection} onSessionUpdate={setSession} />
      </div>
    </div>
  );
}
