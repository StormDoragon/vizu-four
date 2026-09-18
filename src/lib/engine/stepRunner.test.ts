import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeRunStep } from "./stepRunner";

describe("executeRunStep", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "actions-debugger-test-"));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("captures stdout and a zero exit code", async () => {
    const result = await executeRunStep({
      script: "echo hello-world",
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-world");
    expect(result.spawnError).toBeUndefined();
  });

  it("does not leak the server's own process.env into the debugged step", async () => {
    const key = "ACTIONS_DEBUGGER_TEST_SECRET";
    process.env[key] = "should-not-be-visible";
    try {
      const result = await executeRunStep({
        script: `echo "[$${key}]"`,
        cwd,
        env: {},
        extraPath: [],
      });
      expect(result.stdout).toContain("[]");
    } finally {
      delete process.env[key];
    }
  });

  it("keeps head and tail of a stream that exceeds the capture cap, instead of dropping the tail", async () => {
    // 350k chars of 'a' comfortably exceeds HEAD_CHARS + TAIL_CHARS (300k),
    // with a distinctive marker right at the very end where a real error
    // usually is.
    const result = await executeRunStep({
      script:
        'python3 -c "import sys; sys.stdout.write(\'a\' * 350000); sys.stdout.write(\'END-OF-LOG\')"',
      shell: "bash",
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.stdout).toContain("output truncated");
    expect(result.stdout.startsWith("a")).toBe(true);
    expect(result.stdout.endsWith("END-OF-LOG")).toBe(true);
  });

  it("interleaves stdout and stderr in one chronological combined log", async () => {
    // Small sleeps between writes give each pipe time to be read separately
    // before the next write, so the combined ordering reliably reflects
    // wall-clock arrival order rather than racing on event-loop scheduling.
    const result = await executeRunStep({
      script: "echo out1; sleep 0.05; echo err1 1>&2; sleep 0.05; echo out2; sleep 0.05; echo err2 1>&2",
      cwd,
      env: {},
      extraPath: [],
    });
    const streams = result.combined.map((c) => c.stream);
    expect(streams).toContain("stdout");
    expect(streams).toContain("stderr");
    const joined = result.combined.map((c) => c.text).join("");
    // Chronological: out1 before err1 before out2 before err2.
    expect(joined.indexOf("out1")).toBeLessThan(joined.indexOf("err1"));
    expect(joined.indexOf("err1")).toBeLessThan(joined.indexOf("out2"));
    expect(joined.indexOf("out2")).toBeLessThan(joined.indexOf("err2"));
  });

  it("still inherits the allowlisted host PATH so the shell/tools resolve", async () => {
    const result = await executeRunStep({
      script: "echo PATH=$PATH",
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.stdout).toContain(process.env.PATH ?? "");
  });

  it("lets a workflow's env: override CI/GITHUB_ACTIONS/GITHUB_WORKSPACE defaults", async () => {
    const result = await executeRunStep({
      script: "echo CI=$CI ACTIONS=$GITHUB_ACTIONS WS=$GITHUB_WORKSPACE",
      cwd,
      env: { CI: "false", GITHUB_ACTIONS: "false", GITHUB_WORKSPACE: "/custom/workspace" },
      extraPath: [],
    });
    expect(result.stdout).toContain("CI=false ACTIONS=false WS=/custom/workspace");
  });

  it("never lets a workflow's env: redirect engine-owned GITHUB_OUTPUT/RUNNER_TEMP", async () => {
    const result = await executeRunStep({
      script: 'echo "x=1" >> "$GITHUB_OUTPUT"',
      cwd,
      env: { GITHUB_OUTPUT: "/nonexistent/wrong-path", RUNNER_TEMP: "/nonexistent/wrong-temp" },
      extraPath: [],
      runnerTempDir: cwd,
    });
    expect(result.outputs).toEqual({ x: "1" });
  });

  it("captures a non-zero exit code and stderr", async () => {
    const result = await executeRunStep({
      script: "echo boom 1>&2\nexit 7",
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("boom");
  });

  it("passes through custom env vars", async () => {
    const result = await executeRunStep({
      script: "echo $MY_VAR",
      cwd,
      env: { MY_VAR: "injected-value" },
      extraPath: [],
    });
    expect(result.stdout).toContain("injected-value");
  });

  it("parses $GITHUB_OUTPUT written by the script", async () => {
    const result = await executeRunStep({
      script: 'echo "greeting=hello" >> "$GITHUB_OUTPUT"',
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.outputs).toEqual({ greeting: "hello" });
  });

  it("parses multiline $GITHUB_OUTPUT heredoc syntax", async () => {
    const result = await executeRunStep({
      script: [
        "{",
        "  echo 'body<<EOF'",
        "  echo 'line one'",
        "  echo 'line two'",
        "  echo EOF",
        "} >> \"$GITHUB_OUTPUT\"",
      ].join("\n"),
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.outputs.body).toBe("line one\nline two");
  });

  it("parses $GITHUB_ENV additions for use by later steps", async () => {
    const result = await executeRunStep({
      script: 'echo "CARRIED=yes" >> "$GITHUB_ENV"',
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.envAdditions).toEqual({ CARRIED: "yes" });
  });

  it("captures $GITHUB_STEP_SUMMARY", async () => {
    const result = await executeRunStep({
      script: 'echo "## Summary" >> "$GITHUB_STEP_SUMMARY"',
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.summary).toContain("## Summary");
  });

  it("times out long-running scripts", async () => {
    const result = await executeRunStep({
      script: "sleep 30",
      cwd,
      env: {},
      extraPath: [],
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 10000);

  it("reports a spawn error for a nonexistent interpreter", async () => {
    const result = await executeRunStep({
      script: "echo hi",
      shell: "this-shell-does-not-exist-xyz",
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.spawnError).toBeDefined();
  });

  it("cleans up its temp dir even when setup throws before spawning (crash-safe)", async () => {
    const mkdtempSpy = vi.spyOn(fs, "mkdtemp");
    const writeFileSpy = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("disk full"));

    await expect(
      executeRunStep({ script: "echo hi", cwd, env: {}, extraPath: [] })
    ).rejects.toThrow("disk full");

    const createdDir = await mkdtempSpy.mock.results[0]!.value;
    await expect(fs.stat(createdDir)).rejects.toThrow();

    mkdtempSpy.mockRestore();
    writeFileSpy.mockRestore();
  });
});
