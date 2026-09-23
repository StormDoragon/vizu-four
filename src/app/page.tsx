"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  control,
  createSession,
  getDeploymentConfig,
  listExamples,
  listWorkspaceWorkflows,
  setMockOutputs,
  type ExampleWorkflow,
  type ParseIssue,
  type WorkspaceWorkflowFile,
} from "@/lib/apiClient";
import { saveWorkflowSource } from "@/lib/workflowSourceCache";

// A dedicated, minimal workflow for the one-click failure demo. Its "Run
// tests" step is mocked to fail (see startFailureDemo) rather than relying
// on its own `exit 1` actually running - a simulation-only deployment
// (VIZU_DEMO_MODE=1, which any public deploy of this app requires) reports
// every `run:` step as a success by default and never executes it, so the
// literal exit code here would otherwise be silently ignored on exactly the
// deployment this button exists for.
const FAILURE_DEMO_YAML = `name: One-Click Failure Demo
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Install dependencies
        run: echo "installing dependencies"
      - name: Run tests
        run: |
          echo "running tests"
          exit 1
`;

const PLACEHOLDER = `name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: echo "npm ci"
      - name: Run tests
        id: tests
        run: |
          echo "Testing on node \${{ matrix.node }}"
          if [ "\${{ matrix.node }}" = "18" ]; then
            echo "unexpected failure on 18" 1>&2
            exit 1
          fi
      - name: Report
        if: always()
        run: 'echo "tests outcome: \${{ steps.tests.outcome }}"'
`;

export default function HomePage() {
  const router = useRouter();
  const [yaml, setYaml] = useState(PLACEHOLDER);
  const [examples, setExamples] = useState<ExampleWorkflow[]>([]);
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failureDemoLoading, setFailureDemoLoading] = useState(false);

  // "Open a workflow from the repo" - a directory path on the machine
  // running the debugger (this is local-first: browsers can't hand a server
  // a real filesystem path from a file picker, so a text field is the
  // honest UI for what's actually happening).
  const [simulationOnly, setSimulationOnly] = useState(false);
  const [directory, setDirectory] = useState("");
  const [browsedDir, setBrowsedDir] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceWorkflowFile[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // The opt-in proper: loading a file above never flips this on by itself.
  const [runAgainstDir, setRunAgainstDir] = useState(false);

  useEffect(() => {
    listExamples().then(setExamples).catch(() => setExamples([]));
    getDeploymentConfig()
      .then((c) => setSimulationOnly(c.simulationOnly))
      .catch(() => setSimulationOnly(false));
  }, []);

  async function browse() {
    setBrowsing(true);
    setBrowseError(null);
    setWorkspaceFiles([]);
    setBrowsedDir(null);
    try {
      const files = await listWorkspaceWorkflows(directory);
      setWorkspaceFiles(files);
      setBrowsedDir(directory);
      if (files.length === 0) {
        setBrowseError(`No .yml/.yaml files found under ${directory}/.github/workflows`);
      }
    } catch (err) {
      setBrowseError((err as Error).message);
    } finally {
      setBrowsing(false);
    }
  }

  function loadWorkspaceFile(file: WorkspaceWorkflowFile) {
    setYaml(file.content);
    setSelectedFile(file.relativePath);
  }

  async function start() {
    setLoading(true);
    setError(null);
    setIssues([]);
    try {
      const { session, issues } = await createSession(yaml, {
        sourcePath: selectedFile ?? undefined,
        workingTreeDir: runAgainstDir && browsedDir ? browsedDir : undefined,
      });
      setIssues(issues);
      // The server discards the raw YAML once it's parsed - this is the
      // only place the app ever sees it, so it's cached here (keyed by the
      // same hash the session itself exposes) for "Share this session" to
      // read back later, from inside the debugger.
      saveWorkflowSource(session.workflowHash, yaml);
      router.push(`/debug/${session.id}`);
    } catch (err) {
      const apiErr = err as { message?: string; body?: { issues?: ParseIssue[] } };
      setError(apiErr.message ?? "Failed to create session");
      setIssues(apiErr.body?.issues ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function startFailureDemo() {
    setFailureDemoLoading(true);
    setError(null);
    setIssues([]);
    try {
      const { session, issues } = await createSession(FAILURE_DEMO_YAML);
      setIssues(issues);
      saveWorkflowSource(session.workflowHash, FAILURE_DEMO_YAML);
      // Mocked instead of trusting the step's own `exit 1` to actually run -
      // see the comment on FAILURE_DEMO_YAML for why that can't be relied on.
      const failingStep = session.workflow.jobs.build.steps[1];
      await setMockOutputs(session.id, "build", failingStep.key, {
        outputs: {},
        exitCode: 1,
        stderr: "AssertionError: expected 2 to equal 3",
      });
      // Drives the whole graph to completion before navigating, so landing
      // on the debugger already shows the failure - the point of "one
      // click" is not having to also click Run all yourself.
      await control(session.id, "runAll");
      router.push(`/debug/${session.id}`);
    } catch (err) {
      const apiErr = err as { message?: string; body?: { issues?: ParseIssue[] } };
      setError(apiErr.message ?? "Failed to start the failure demo");
      setIssues(apiErr.body?.issues ?? []);
    } finally {
      setFailureDemoLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Actions Visual Debugger</h1>
          <p className="mt-1 text-sm text-ink-400">
            Paste a GitHub Actions workflow, then step through it locally with breakpoints, live
            context inspection, matrix exploration, and what-if editing.
          </p>
        </div>
        <button
          onClick={startFailureDemo}
          disabled={failureDemoLoading}
          data-testid="failure-demo"
          title="Loads a workflow with a real failing step and jumps straight to it - no setup"
          className="shrink-0 rounded-md border border-status-failure/50 bg-status-failure/10 px-4 py-2 text-sm font-medium text-status-failure hover:bg-status-failure/20 disabled:opacity-50"
        >
          {failureDemoLoading ? "Starting…" : "⚠ See a failure debugged (one click)"}
        </button>
      </header>

      {examples.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex.name}
              onClick={() => {
                setYaml(ex.content);
                setSelectedFile(null);
              }}
              className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-sm text-ink-200 hover:border-status-running hover:text-ink"
            >
              {ex.label ?? ex.name}
            </button>
          ))}
        </div>
      )}

      <textarea
        value={yaml}
        onChange={(e) => {
          setYaml(e.target.value);
          setSelectedFile(null);
        }}
        spellCheck={false}
        className="h-[420px] w-full rounded-lg border border-bg-border bg-bg-panel p-4 font-mono text-sm text-ink-100 focus:border-status-running focus:outline-none"
      />

      <section className="rounded-lg border border-bg-border bg-bg-panel p-4">
        <h2 className="text-sm font-semibold text-ink">Open a workflow from the repo</h2>
        {simulationOnly ? (
          <p className="mt-1 text-xs text-ink-500">
            Disabled in this deployment — real working-tree access is off along with{" "}
            <code>run:</code> execution.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-500">
              Enter a directory on this machine (relative paths resolve against the debugger&apos;s
              own working directory, so <code>.</code> means &ldquo;the repo this is running
              from&rdquo;). Lists <code>.github/workflows/*.yml</code> there.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                placeholder="/path/to/repo or ."
                data-testid="workspace-dir-input"
                className="flex-1 rounded-md border border-bg-border bg-bg-raised px-2 py-1.5 font-mono text-xs text-ink-200 focus:border-status-running focus:outline-none"
              />
              <button
                onClick={browse}
                disabled={browsing || directory.trim() === ""}
                data-testid="workspace-browse"
                className="rounded-md border border-bg-border px-3 py-1.5 text-xs text-ink-200 hover:border-status-running hover:text-ink disabled:opacity-50"
              >
                {browsing ? "Listing…" : "List workflows"}
              </button>
            </div>

            {browseError && <p className="mt-2 text-xs text-red-300">{browseError}</p>}

            {workspaceFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {workspaceFiles.map((f) => (
                  <li key={f.relativePath}>
                    <button
                      onClick={() => loadWorkspaceFile(f)}
                      data-testid="workspace-file"
                      className={`w-full rounded-md border px-2 py-1.5 text-left text-xs hover:border-status-running hover:text-ink ${
                        selectedFile === f.relativePath
                          ? "border-status-running bg-status-running/10 text-ink"
                          : "border-bg-border bg-bg-raised text-ink-200"
                      }`}
                    >
                      {f.relativePath}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {browsedDir && (
              <div className="mt-3 border-t border-bg-border pt-3">
                <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-300">
                  <input
                    type="checkbox"
                    checked={runAgainstDir}
                    onChange={(e) => setRunAgainstDir(e.target.checked)}
                    data-testid="run-against-dir"
                    className="mt-0.5 accent-status-running"
                  />
                  <span>
                    Run this session&apos;s <code>run:</code> steps against{" "}
                    <code>{browsedDir}</code> instead of a scratch workspace.{" "}
                    <strong className="text-yellow-300">
                      This is not a copy — steps execute for real against the files in that
                      directory.
                    </strong>
                  </span>
                </label>
              </div>
            )}
          </>
        )}
      </section>

      {error && (
        <div className="rounded-md border border-status-failure/40 bg-status-failure/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {issues.length > 0 && (
        <ul className="space-y-1 rounded-md border border-bg-border bg-bg-panel p-3 text-sm">
          {issues.map((issue, i) => (
            <li
              key={i}
              className={issue.severity === "error" ? "text-red-300" : "text-yellow-300"}
            >
              [{issue.severity}] {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div>
        <button
          onClick={start}
          disabled={loading}
          className="rounded-md bg-status-running px-5 py-2.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Starting…" : "Start Debugging"}
        </button>
      </div>

      <footer className="mt-auto pt-8 text-xs text-ink-500">
        {simulationOnly ? (
          <>
            Simulation-only deployment: <code>run:</code> steps are never executed here - each
            shows the command it would have run, and a mock decides its result.{" "}
            <code>uses:</code> actions are simulated. See the README for full scope.
          </>
        ) : (
          <>
            Local-first MVP: <code>run:</code> steps execute for real in a scratch workspace on
            this machine; <code>uses:</code> actions are simulated. See the README for full scope.
          </>
        )}
      </footer>
    </main>
  );
}
