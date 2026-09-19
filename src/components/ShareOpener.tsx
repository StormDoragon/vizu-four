"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  applyWhatIf,
  control,
  createSession,
  setActiveLane,
  setBreakpoint,
  setMockOutputs,
  type ParseIssue,
} from "@/lib/apiClient";
import type { SessionView } from "@/lib/engine/serialize";
import { decodeSharePayload, type SharePayload } from "@/lib/share";
import { saveWorkflowSource } from "@/lib/workflowSourceCache";
import { splitBreakpoint } from "@/lib/debugPrefs";
import { comboKey, type MatrixCombo } from "@/lib/workflow/matrix";

const TERMINAL = new Set(["success", "failure", "skipped", "cancelled"]);
// Sum of every lane's target stepIndex is the real bound on how many
// "step" calls a correct replay ever needs - this only exists as a
// last-resort guard against looping forever on a payload whose progress
// somehow never becomes reachable (e.g. a dependency that can't finish).
const MAX_REPLAY_STEPS = 2000;

function findLane(session: SessionView, jobId: string, matrix: MatrixCombo) {
  const key = comboKey(matrix);
  return session.laneOrder.map((id) => session.lanes[id]).find((l) => l.jobId === jobId && comboKey(l.matrix) === key);
}

/** Applies breakpoints, What-If overrides, mocks, and replays lane
 * progress onto a freshly-created session until it matches what was
 * shared - `needs`-blocked lanes are skipped and retried each pass, since
 * they can only unblock once their own dependency lanes reach a terminal
 * status (same as normal execution; see comment on SharePayload.progress). */
async function reconstruct(payload: SharePayload, session: SessionView): Promise<SessionView> {
  let latest = session;

  const hasWhatIf =
    payload.breakOnFailure !== latest.breakOnFailure ||
    Object.keys(payload.env).length > 0 ||
    Object.keys(payload.vars).length > 0;
  if (hasWhatIf) {
    latest = (await applyWhatIf(latest.id, { env: payload.env, vars: payload.vars, breakOnFailure: payload.breakOnFailure }))
      .session;
  }

  for (const bp of payload.breakpoints) {
    const parts = splitBreakpoint(bp);
    if (!parts) continue;
    latest = (await setBreakpoint(latest.id, parts.jobId, parts.stepKey, true)).session;
  }

  for (const [key, mock] of Object.entries(payload.mockOutputs)) {
    const parts = splitBreakpoint(key); // same "jobId:stepKey" format
    if (!parts) continue;
    latest = (await setMockOutputs(latest.id, parts.jobId, parts.stepKey, mock)).session;
  }

  const targets = payload.progress
    .map((p) => ({ ...p, laneId: findLane(latest, p.jobId, p.matrix)?.id }))
    .filter((t): t is typeof t & { laneId: string } => t.laneId !== undefined);

  let stepsTaken = 0;
  let progressed = true;
  while (progressed && stepsTaken < MAX_REPLAY_STEPS) {
    progressed = false;
    for (const target of targets) {
      const lane = latest.lanes[target.laneId];
      if (!lane || lane.pointer >= target.stepIndex) continue;
      if (lane.status === "blocked" || TERMINAL.has(lane.status)) continue;
      latest = (await control(latest.id, "step", target.laneId)).session;
      stepsTaken++;
      progressed = true;
    }
  }

  if (payload.activeLane) {
    const lane = findLane(latest, payload.activeLane.jobId, payload.activeLane.matrix);
    if (lane) latest = (await setActiveLane(latest.id, lane.id)).session;
  }

  return latest;
}

export function ShareOpener({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [parseIssues, setParseIssues] = useState<ParseIssue[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const payload = decodeSharePayload(token);
      if (!payload) {
        setError("This share link is invalid or corrupted.");
        return;
      }
      try {
        const { session, issues } = await createSession(payload.yaml);
        if (cancelled) return;
        saveWorkflowSource(session.workflowHash, payload.yaml);
        setParseIssues(issues);
        const reconstructed = await reconstruct(payload, session);
        if (!cancelled) router.replace(`/debug/${reconstructed.id}?shared=1`);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to open the shared session.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-4 text-center text-sm">
        <p className="max-w-md text-red-300">{error}</p>
        {parseIssues.length > 0 && (
          <ul className="max-w-md space-y-0.5 text-xs text-yellow-300">
            {parseIssues.map((issue, i) => (
              <li key={i}>⚠ {issue.message}</li>
            ))}
          </ul>
        )}
        <Link href="/" className="text-status-running hover:underline">
          ← Back home
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center text-sm text-ink-500">
      Reconstructing shared session…
    </div>
  );
}
