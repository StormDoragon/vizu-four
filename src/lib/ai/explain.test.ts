import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireAiCall, aiBudgetUsage, resetAiBudget } from "./budget";
import { explainFailure, explainFailureHeuristic, maskExplainInput, type ExplainInput } from "./explain";

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

describe("budget", () => {
  const input: ExplainInput = {
    stepName: "build",
    run: "npm test",
    exitCode: 1,
    stdout: "",
    stderr: "boom",
  };

  beforeEach(() => resetAiBudget());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetAiBudget();
  });

  it("does not call the provider once the window's budget is spent", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-used");
    vi.stubEnv("VIZU_AI_MAX_CALLS_PER_WINDOW", "1");
    // Spend the window's single call and hand the slot back, so only the
    // spend cap - not concurrency - is what refuses the next one.
    const spent = acquireAiCall();
    expect(typeof spent).not.toBe("string");
    (spent as { release: () => void }).release();

    const explanation = await explainFailure(input);
    // Degraded, not failed: the offline explanation is still returned.
    expect(explanation.source).toBe("heuristic");
    expect(explanation.summary).toBeTruthy();
    expect(explanation.causes.length).toBeGreaterThan(0);
  });

  it("does not call the provider when every concurrency slot is held", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-used");
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "1");
    const held = acquireAiCall();
    expect(typeof held).not.toBe("string");

    const explanation = await explainFailure(input);
    expect(explanation.source).toBe("heuristic");
    (held as { release: () => void }).release();
  });

  it("releases its slot even when the provider call throws", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-used");
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "2");
    // No network here, so the SDK call fails - which is the path that must
    // still return the slot, or a few failures exhaust the pool forever.
    const explanation = await explainFailure(input);
    expect(explanation.source).toBe("heuristic");
    expect(aiBudgetUsage().inFlight).toBe(0);
  });

  it("never touches the budget when no API key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const explanation = await explainFailure(input);
    expect(explanation.source).toBe("heuristic");
    expect(aiBudgetUsage().calls).toBe(0);
  });

  it("bounds the whole logical call (retries included), not just one HTTP attempt", async () => {
    // The SDK's `timeout` request option resets on every retry - a hung
    // provider could take up to (1 + maxRetries) times the configured
    // budget instead of at most it. An AbortSignal-based deadline is what
    // actually bounds one logical call across all of its retries, so that's
    // what a live call must be issued with instead.
    let capturedOptions: { signal?: AbortSignal; timeout?: number } | undefined;
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: (_body: unknown, options: { signal?: AbortSignal; timeout?: number }) => {
            capturedOptions = options;
            return Promise.resolve({
              content: [{ type: "text", text: '{"summary":"s","causes":[{"title":"t","detail":"d"}]}' }],
            });
          },
        };
      },
    }));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-used");
    vi.stubEnv("VIZU_AI_TIMEOUT_MS", "5000");

    const explanation = await explainFailure(input);

    expect(explanation.source).toBe("claude");
    expect(capturedOptions?.signal).toBeInstanceOf(AbortSignal);
    // Not the per-attempt `timeout` option, which the SDK's own retries
    // would each get their own fresh copy of.
    expect(capturedOptions?.timeout).toBeUndefined();

    vi.doUnmock("@anthropic-ai/sdk");
  });
});

describe("explainFailure with a reply that isn't shaped the way it was asked for", () => {
  const failed: ExplainInput = {
    stepName: "build",
    run: "npm test",
    exitCode: 1,
    stdout: "",
    stderr: "boom",
  };

  function replyWith(text: string) {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create: () => Promise.resolve({ content: [{ type: "text", text }] }) };
      },
    }));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-used");
  }

  beforeEach(() => resetAiBudget());
  afterEach(() => {
    vi.doUnmock("@anthropic-ai/sdk");
    vi.unstubAllEnvs();
    resetAiBudget();
  });

  it("never hands the UI a cause whose fields aren't strings", async () => {
    // Every field is rendered as a React child, where an object throws. The
    // reply is shaped by the step's own output - which a crafted log or a
    // shared link's mocked stderr controls - so it can't be trusted to be
    // the shape it was asked for.
    replyWith(
      JSON.stringify({
        summary: "It failed.",
        causes: [
          { title: { injected: true }, detail: "d", confidence: "high" },
          { title: "Real cause", detail: "Real detail", confidence: "certain", suggestion: 42 },
        ],
      })
    );
    const explanation = await explainFailure(failed);

    expect(explanation.source).toBe("claude");
    for (const cause of explanation.causes) {
      expect(typeof cause.title).toBe("string");
      expect(typeof cause.detail).toBe("string");
      expect(["high", "medium", "low"]).toContain(cause.confidence);
      expect(cause.suggestion === undefined || typeof cause.suggestion === "string").toBe(true);
    }
    expect(explanation.causes.map((c) => c.title)).toEqual(["Real cause"]);
  });

  it("falls back to the heuristics when nothing in the reply is usable", async () => {
    replyWith(JSON.stringify({ summary: { not: "a string" }, causes: [{ title: 1, detail: 2 }] }));
    const explanation = await explainFailure(failed);
    expect(explanation.source).toBe("heuristic");
    expect(typeof explanation.summary).toBe("string");
  });
});

describe("maskExplainInput", () => {
  it("masks a value that only became a secret after the step's output was captured", () => {
    // Captured output is masked against the secrets known at capture time.
    // Declaring one afterwards leaves it in the record - and this input is
    // what gets sent to a third-party API.
    const token = "tok_live_1234567890";
    const masked = maskExplainInput(
      {
        stepName: "deploy",
        run: `curl -H 'Authorization: ${token}' https://example.test`,
        exitCode: 1,
        stdout: `using ${token}`,
        stderr: `401 for ${token}`,
        engineError: `failed with ${token}`,
        ifError: `bad ${token}`,
        timedOut: false,
      },
      [token]
    );
    expect(JSON.stringify(masked)).not.toContain(token);
    expect(masked.stdout).toBe("using ***");
    expect(masked.exitCode).toBe(1);
    expect(masked.timedOut).toBe(false);
  });
});
