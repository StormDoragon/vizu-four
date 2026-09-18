"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSession, listExamples, type ExampleWorkflow, type ParseIssue } from "@/lib/apiClient";

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

  useEffect(() => {
    listExamples().then(setExamples).catch(() => setExamples([]));
  }, []);

  async function start() {
    setLoading(true);
    setError(null);
    setIssues([]);
    try {
      const { session, issues } = await createSession(yaml);
      setIssues(issues);
      router.push(`/debug/${session.id}`);
    } catch (err) {
      const apiErr = err as { message?: string; body?: { issues?: ParseIssue[] } };
      setError(apiErr.message ?? "Failed to create session");
      setIssues(apiErr.body?.issues ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-white">Actions Visual Debugger</h1>
        <p className="mt-1 text-sm text-gray-400">
          Paste a GitHub Actions workflow, then step through it locally with breakpoints, live
          context inspection, matrix exploration, and what-if editing.
        </p>
      </header>

      {examples.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex.name}
              onClick={() => setYaml(ex.content)}
              className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-sm text-gray-200 hover:border-status-running hover:text-white"
            >
              {ex.name}
            </button>
          ))}
        </div>
      )}

      <textarea
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        spellCheck={false}
        className="h-[420px] w-full rounded-lg border border-bg-border bg-bg-panel p-4 font-mono text-sm text-gray-100 focus:border-status-running focus:outline-none"
      />

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

      <footer className="mt-auto pt-8 text-xs text-gray-500">
        Local-first MVP: <code>run:</code> steps execute for real in a scratch workspace on this
        machine; <code>uses:</code> actions are simulated. See the README for full scope.
      </footer>
    </main>
  );
}
