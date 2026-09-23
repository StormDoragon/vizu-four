"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  applyWhatIf,
  control,
  createSession,
  grantExecutionConsent,
  setActiveLane,
  setBreakpoint,
  setMockOutputs,
  type ParseIssue,
} from "@/lib/apiClient";
import type { SessionView } from "@/lib/engine/serialize";
import { decodeSharePayload, type SharePayload } from "@/lib/share";
import type { StepMock } from "@/lib/engine/types";
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
/** Everything a link carries that does not run anything: overrides,
 * breakpoints and mocked step results. Safe to apply on open. */
async function applyShareConfig(
  payload: SharePayload,
  session: SessionView
): Promise<SessionView> {
  let latest = session;

  const hasWhatIf =
    payload.breakOnFailure !== latest.breakOnFailure ||
    Object.keys(payload.env).length > 0 ||
    Object.keys(payload.vars).length > 0;
  if (hasWhatIf) {
    latest = (await applyWhatIf(latest.id, { env: payload.env, vars: payload.vars, breakOnFailure: payload.breakOnFailure }))
      .session;
  }

  // A breakpoint or mock naming a job/step the workflow doesn't have is
  // skipped, not fatal. The token carries its own YAML, so these agree for
  // any link this app produced - but the token is user-editable text, and
  // one bad entry in it should cost that entry, not the whole session. The
  // server refuses an unknown job or step on both routes, so "skip what it
  // rejects" is the only way to stay open to the rest of the link.
  for (const bp of payload.breakpoints) {
    const parts = splitBreakpoint(bp);
    if (!parts) continue;
    try {
      latest = (await setBreakpoint(latest.id, parts.jobId, parts.stepKey, true)).session;
    } catch {
      // Unknown job or step - leave `latest` as it was and carry on.
    }
  }

  for (const [key, mock] of Object.entries(payload.mockOutputs)) {
    const parts = splitBreakpoint(key); // same "jobId:stepKey" format
    if (!parts) continue;
    try {
      latest = (await setMockOutputs(latest.id, parts.jobId, parts.stepKey, mock)).session;
    } catch {
      // As above.
    }
  }

  return latest;
}

/** Focuses the lane the link was shared from. Selecting a lane runs nothing. */
async function focusSharedLane(
  payload: SharePayload,
  session: SessionView
): Promise<SessionView> {
  if (!payload.activeLane) return session;
  const lane = findLane(session, payload.activeLane.jobId, payload.activeLane.matrix);
  return lane ? (await setActiveLane(session.id, lane.id)).session : session;
}

async function reconstruct(payload: SharePayload, session: SessionView): Promise<SessionView> {
  let latest = await applyShareConfig(payload, session);

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

  return focusSharedLane(payload, latest);
}

/** A step mock decides a step's result outright, so what it says matters as
 * much as the YAML when judging what a replay would do. */
function describeMock(mock: StepMock): string {
  const parts: string[] = [];
  const outputs = Object.keys(mock.outputs ?? {});
  if (outputs.length > 0) parts.push(`outputs ${outputs.join(", ")}`);
  if (mock.exitCode !== undefined) parts.push(`exit ${mock.exitCode}`);
  if (mock.stderr) parts.push("stderr set");
  return parts.length > 0 ? parts.join(", ") : "no change";
}

function Imported({ label, entries }: { label: string; entries: [string, string][] }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-ink-400">{label}:</dt>
      <dd className="text-ink-200">
        {entries.length === 0 ? (
          <span className="text-ink-500">none</span>
        ) : (
          <ul className="space-y-0.5">
            {entries.map(([key, value]) => (
              <li key={key} className="font-mono">
                {key} <span className="text-ink-400">— {value}</span>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

export function ShareOpener({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [parseIssues, setParseIssues] = useState<ParseIssue[]>([]);
  const [prepared, setPrepared] = useState<{
    payload: SharePayload;
    session: SessionView;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Creating the session parses the workflow and applies the link's
  // breakpoints, overrides and mocks - none of which execute anything. The
  // replay is what runs steps, and it waits for an explicit choice: the
  // link's author is not necessarily someone the recipient trusts with
  // shell commands on their own machine.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const payload = decodeSharePayload(token);
      if (!payload) {
        setError("This share link is invalid or corrupted.");
        return;
      }
      try {
        const { session, issues } = await createSession(payload.yaml, { fromSharedLink: true });
        if (cancelled) return;
        saveWorkflowSource(session.workflowHash, payload.yaml);
        setParseIssues(issues);
        setPrepared({ payload, session });
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to open the shared session.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function open(replay: boolean) {
    if (!prepared) return;
    setBusy(true);
    try {
      let session = prepared.session;
      if (replay) {
        // Server-side too: the engine refuses to run an unconsented shared
        // session, so skipping this UI does not skip the decision.
        session = (await grantExecutionConsent(session.id)).session;
        session = await reconstruct(prepared.payload, session);
      } else {
        session = await focusSharedLane(
          prepared.payload,
          await applyShareConfig(prepared.payload, session)
        );
      }
      router.replace(`/debug/${session.id}?shared=1`);
    } catch (err) {
      setError((err as Error).message || "Failed to open the shared session.");
      setBusy(false);
    }
  }

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

  if (!prepared) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-ink-500">
        Opening shared session…
      </div>
    );
  }

  const { payload, session } = prepared;
  const stepsToReplay = payload.progress.reduce((n, p) => n + p.stepIndex, 0);
  const lanesToReplay = payload.progress.filter((p) => p.stepIndex > 0).length;
  const runsForReal = !session.simulationOnly;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-6 py-10">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          {session.workflow.name ?? "Shared workflow"}
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Someone shared this workflow with you. Nothing has run yet.
        </p>
      </div>

      {parseIssues.length > 0 && (
        <ul className="space-y-1 rounded-md border border-bg-border bg-bg-panel p-3 text-sm">
          {parseIssues.map((issue, i) => (
            <li key={i} className={issue.severity === "error" ? "text-red-300" : "text-yellow-300"}>
              [{issue.severity}] {issue.message}
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-lg border border-bg-border bg-bg-panel p-4 text-sm">
        <h2 className="text-sm font-semibold text-ink">What this link asks to replay</h2>
        <p className="mt-1 text-ink-300">
          {stepsToReplay === 0
            ? "No steps - the link shares the workflow and its setup only."
            : `${stepsToReplay} step${stepsToReplay === 1 ? "" : "s"} across ${lanesToReplay} lane${
                lanesToReplay === 1 ? "" : "s"
              }.`}
        </p>
        <p className="mt-2 text-xs text-ink-500">
          The settings below are applied either way - none of them execute anything, but they do
          change what the steps would do, so they are worth reading before allowing a replay.
        </p>

        <dl className="mt-3 space-y-2 text-xs" data-testid="share-imported-config">
          <Imported label="Env overrides" entries={Object.entries(payload.env)} />
          <Imported label="Vars overrides" entries={Object.entries(payload.vars)} />
          <Imported
            label="Mocked steps"
            entries={Object.entries(payload.mockOutputs).map(([key, mock]) => [
              key,
              describeMock(mock),
            ])}
          />
          <Imported
            label="Breakpoints"
            entries={payload.breakpoints.map((bp) => [bp, "pauses here"])}
          />
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-400">Pause on failure:</dt>
            <dd className="text-ink-200">{payload.breakOnFailure ? "on" : "off"}</dd>
          </div>
        </dl>
      </section>

      <pre className="max-h-72 overflow-auto rounded-lg border border-bg-border bg-bg-raised p-3 font-mono text-xs text-ink-200">
        {payload.yaml}
      </pre>

      {runsForReal && stepsToReplay > 0 && (
        <div
          data-testid="share-execution-warning"
          className="rounded-md border border-status-failure/50 bg-status-failure/10 p-3 text-sm text-red-300"
        >
          <strong>Replaying runs this workflow&apos;s <code>run:</code> steps for real</strong> on
          this machine, as this process, because real execution is enabled here. Read the workflow
          above before choosing to replay it.
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => open(false)}
          disabled={busy}
          data-testid="share-inspect"
          className="rounded-md bg-status-running px-5 py-2.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Inspect without running
        </button>
        <button
          onClick={() => open(true)}
          disabled={busy || stepsToReplay === 0}
          data-testid="share-replay"
          className="rounded-md border border-bg-border px-5 py-2.5 font-medium text-ink-200 hover:border-status-running hover:text-ink disabled:opacity-50"
        >
          {busy ? "Working…" : "Replay steps"}
        </button>
        <Link
          href="/"
          className="self-center text-sm text-status-running hover:underline"
        >
          ← Back home
        </Link>
      </div>
    </main>
  );
}
