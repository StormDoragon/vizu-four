import type { EvalContext } from "./evaluator";

/** Generic sample data so the expression playground works before any debug session exists. */
export function sampleEvalContext(cwd: string): EvalContext {
  return {
    contexts: {
      github: {
        event_name: "push",
        ref: "refs/heads/main",
        ref_name: "main",
        sha: "1111111111111111111111111111111111111111",
        actor: "octocat",
        repository: "octocat/hello-world",
        run_id: "1",
        run_number: "1",
        workflow: "CI",
        job: "build",
        event: { head_commit: { message: "Sample commit" } },
      },
      env: { NODE_ENV: "production" },
      vars: { DEPLOY_ENV: "staging" },
      secrets: {},
      matrix: { os: "ubuntu-latest", node: 18 },
      needs: {},
      steps: {
        checkout: { outputs: {}, outcome: "success", conclusion: "success" },
      },
      runner: { os: "Linux", arch: "X64", temp: "/tmp", tool_cache: "/opt/tools" },
      job: { status: "success" },
      inputs: {},
      strategy: { "fail-fast": true },
    },
    status: { anyFailure: false, cancelled: false },
    cwd,
  };
}
