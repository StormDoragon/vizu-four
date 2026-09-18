import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("still inherits the allowlisted host PATH so the shell/tools resolve", async () => {
    const result = await executeRunStep({
      script: "echo PATH=$PATH",
      cwd,
      env: {},
      extraPath: [],
    });
    expect(result.stdout).toContain(process.env.PATH ?? "");
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
});
