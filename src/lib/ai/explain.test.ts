import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { explainFailure, explainFailureHeuristic, type ExplainInput } from "./explain";

function input(overrides: Partial<ExplainInput> = {}): ExplainInput {
  return {
    stepName: "Run tests",
    exitCode: 1,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

describe("explainFailureHeuristic", () => {
  it("recognizes a command-not-found failure", () => {
    const result = explainFailureHeuristic(
      input({ exitCode: 127, stderr: "bash: foobar: command not found" })
    );
    expect(result.causes[0].title).toMatch(/command not found/i);
    expect(result.source).toBe("heuristic");
  });

  it("recognizes a timeout regardless of output", () => {
    const result = explainFailureHeuristic(input({ timedOut: true, exitCode: null }));
    expect(result.causes[0].title).toMatch(/timed out/i);
  });

  it("recognizes failing test assertions", () => {
    const result = explainFailureHeuristic(
      input({ stdout: "Tests: 1 failed, 2 passed\nAssertionError: expected 1 to equal 2" })
    );
    expect(result.causes.some((c) => /test assertions failed/i.test(c.title))).toBe(true);
  });

  it("recognizes an uppercase FAIL token from a test runner", () => {
    const result = explainFailureHeuristic(input({ stdout: "FAIL src/app.test.ts" }));
    expect(result.causes.some((c) => /test assertions failed/i.test(c.title))).toBe(true);
  });

  it("does not mistake a script's own prose for a test failure", () => {
    // Regression test: a lowercase, casual use of "fail" in a script's own
    // echoed output must not trigger the test-assertions heuristic - only
    // an uppercase FAIL token (as real test runners emit) should.
    const result = explainFailureHeuristic(
      input({ stdout: "About to fail on Node 18 to demonstrate the debugger" })
    );
    expect(result.causes.some((c) => /test assertions failed/i.test(c.title))).toBe(false);
  });

  it("recognizes missing credentials", () => {
    const result = explainFailureHeuristic(
      input({ stderr: "remote: Support for password authentication was removed\nfatal: Authentication failed" })
    );
    expect(result.causes.some((c) => /credentials/i.test(c.title))).toBe(true);
  });

  it("surfaces an always-truthy if: warning as a top cause", () => {
    const result = explainFailureHeuristic(
      input({ ifWarning: "This condition mixes literal text with ${{ }}..." })
    );
    expect(result.causes[0].title).toMatch(/always truthy/i);
  });

  it("falls back to a generic cause when nothing matches", () => {
    const result = explainFailureHeuristic(input({ exitCode: 3, stderr: "unrecognized gibberish output" }));
    expect(result.causes).toHaveLength(1);
    expect(result.causes[0].title).toContain("3");
  });

  it("caps at 5 causes", () => {
    const result = explainFailureHeuristic(
      input({
        ifWarning: "warn",
        ifError: "err",
        timedOut: true,
        exitCode: 126,
        stderr: "command not found and permission denied and ENOENT no such file or directory",
      })
    );
    expect(result.causes.length).toBeLessThanOrEqual(5);
  });
});

describe("explainFailure", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("falls back to the heuristic explanation when no API key is configured", async () => {
    const result = await explainFailure(input({ exitCode: 127, stderr: "command not found" }));
    expect(result.source).toBe("heuristic");
    expect(result.causes.length).toBeGreaterThan(0);
  });
});
