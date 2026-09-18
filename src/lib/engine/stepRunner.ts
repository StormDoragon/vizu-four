import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnvFile, parsePathFile } from "./envFile";

const MAX_CAPTURE_BYTES = 300_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Only this narrow, documented allowlist of the host's own environment is
 * passed through to a debugged `run:` step - never the full `process.env`.
 * Without this, any workflow being debugged could read (and print, which
 * the debugger then shows in the browser) server-side secrets that have
 * nothing to do with the workflow, e.g. the `ANTHROPIC_API_KEY` used by the
 * failure-explanation feature, or anything else set on whatever machine or
 * shell happens to be running the debugger's server process.
 */
const INHERITED_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "TZ",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
];

function baseHostEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export interface RunStepOptions {
  script: string;
  shell?: string;
  cwd: string;
  env: Record<string, string>;
  extraPath: string[];
  timeoutMs?: number;
}

export interface RunStepResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputs: Record<string, string>;
  envAdditions: Record<string, string>;
  pathAdditions: string[];
  summary?: string;
  timedOut: boolean;
  spawnError?: string;
}

function buildCommand(shell: string, scriptPath: string): { cmd: string; args: string[] } {
  const normalized = shell.trim();
  if (normalized.includes("{0}")) {
    const parts = normalized.split(" ").map((p) => (p === "{0}" ? scriptPath : p));
    return { cmd: parts[0], args: parts.slice(1) };
  }
  switch (normalized) {
    case "bash":
      return { cmd: "bash", args: ["--noprofile", "--norc", "-eo", "pipefail", scriptPath] };
    case "sh":
      return { cmd: "sh", args: ["-e", scriptPath] };
    case "python":
    case "python3":
      return { cmd: "python3", args: [scriptPath] };
    default:
      return { cmd: normalized, args: [scriptPath] };
  }
}

function capture(chunks: string[], data: Buffer, totalRef: { total: number }): void {
  if (totalRef.total >= MAX_CAPTURE_BYTES) return;
  const text = data.toString("utf8");
  totalRef.total += text.length;
  if (totalRef.total >= MAX_CAPTURE_BYTES) {
    chunks.push(text.slice(0, Math.max(0, text.length - (totalRef.total - MAX_CAPTURE_BYTES))));
    chunks.push("\n… output truncated …\n");
  } else {
    chunks.push(text);
  }
}

/**
 * Executes a `run:` step's script as a real local process - this is what
 * gives the debugger high fidelity for the most common source of CI
 * failures (build/test commands), at the cost of not sandboxing beyond
 * whatever privileges the user running the debugger already has. Treat it
 * exactly like running the script yourself: don't debug workflows you
 * don't trust.
 */
export async function executeRunStep(opts: RunStepOptions): Promise<RunStepResult> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "actions-debugger-step-"));
  const scriptExt = (opts.shell ?? "bash").includes("python") ? ".py" : ".sh";
  const scriptPath = path.join(workDir, `run${scriptExt}`);
  const outputFile = path.join(workDir, "github_output");
  const envFile = path.join(workDir, "github_env");
  const pathFile = path.join(workDir, "github_path");
  const summaryFile = path.join(workDir, "github_step_summary");

  await Promise.all([
    fs.writeFile(scriptPath, opts.script, "utf8"),
    fs.writeFile(outputFile, "", "utf8"),
    fs.writeFile(envFile, "", "utf8"),
    fs.writeFile(pathFile, "", "utf8"),
    fs.writeFile(summaryFile, "", "utf8"),
  ]);

  const { cmd, args } = buildCommand(opts.shell ?? "bash", scriptPath);
  const pathSeparator = process.platform === "win32" ? ";" : ":";
  const mergedPath = [...opts.extraPath, process.env.PATH ?? ""].filter(Boolean).join(pathSeparator);

  const childEnv: Record<string, string> = {
    ...baseHostEnv(),
    ...opts.env,
    PATH: mergedPath,
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_WORKSPACE: opts.cwd,
    GITHUB_OUTPUT: outputFile,
    GITHUB_ENV: envFile,
    GITHUB_PATH: pathFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    RUNNER_TEMP: workDir,
  };

  const result = await new Promise<RunStepResult>((resolve) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const stdoutTotal = { total: 0 };
    const stderrTotal = { total: 0 };
    let settled = false;
    let timedOut = false;

    let child;
    try {
      // `detached: true` makes the child the leader of a new process group,
      // so on timeout we can kill the whole tree (e.g. `sleep` forked by a
      // wrapping `bash`) via `kill(-pid)` instead of leaking an orphan that
      // keeps the stdout/stderr pipes open forever.
      // cmd/cwd are runtime-dynamic by design (whatever the debugged
      // workflow specifies) - this route only ever runs via `next dev`/
      // `next start` on the user's own machine, never traced for a
      // serverless deployment, hence the ignore comment Next's build
      // analyzer looks for.
      child = spawn(/*turbopackIgnore: true*/ cmd, args, {
        cwd: opts.cwd,
        // Cast: NodeJS.ProcessEnv is augmented (by Next's own types) with a
        // required NODE_ENV field that our deliberately-narrow childEnv
        // doesn't carry - spawn itself only needs a string map at runtime.
        env: childEnv as NodeJS.ProcessEnv,
        detached: true,
      });
    } catch (err) {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: "",
        outputs: {},
        envAdditions: {},
        pathAdditions: [],
        timedOut: false,
        spawnError: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Process (group) may already be gone - fine.
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 3000);
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout?.on("data", (d: Buffer) => capture(stdoutChunks, d, stdoutTotal));
    child.stderr?.on("data", (d: Buffer) => capture(stderrChunks, d, stderrTotal));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        outputs: {},
        envAdditions: {},
        pathAdditions: [],
        timedOut,
        spawnError: err.message,
      });
    });

    child.on("close", async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const [outputRaw, envRaw, pathRaw, summaryRaw] = await Promise.all([
        fs.readFile(outputFile, "utf8").catch(() => ""),
        fs.readFile(envFile, "utf8").catch(() => ""),
        fs.readFile(pathFile, "utf8").catch(() => ""),
        fs.readFile(summaryFile, "utf8").catch(() => ""),
      ]);
      resolve({
        exitCode: timedOut ? null : code,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        outputs: parseEnvFile(outputRaw),
        envAdditions: parseEnvFile(envRaw),
        pathAdditions: parsePathFile(pathRaw),
        summary: summaryRaw.trim() ? summaryRaw : undefined,
        timedOut,
      });
    });
  });

  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  return result;
}
