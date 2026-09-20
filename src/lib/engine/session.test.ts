import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWorkflow } from "../workflow/parser";
import {
  applyWhatIf,
  controlContinue,
  controlRunAll,
  controlStep,
  createSession,
  setBreakpoint,
  setMockOutputs,
} from "./session";
import { EngineError } from "./errors";
import { sessionTempRoot } from "./contexts";
import type { DebugSession } from "./types";

let workspaceDir: string;
let createdSessionIds: string[];

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "actions-debugger-session-test-"));
  createdSessionIds = [];
});

afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await Promise.all(
    createdSessionIds.map((id) => fs.rm(sessionTempRoot(id), { recursive: true, force: true }))
  );
});

function session(yaml: string, config?: Parameters<typeof createSession>[0]["config"]): DebugSession {
  const { workflow, issues } = parseWorkflow(yaml);
  const blocking = issues.filter((i) => i.severity === "error");
  if (!workflow || blocking.length > 0) {
    throw new Error(`fixture failed to parse: ${JSON.stringify(blocking)}`);
  }
  const s = createSession({ workflow, workspaceDir, ownerId: "test-owner", config });
  createdSessionIds.push(s.id);
  return s;
}

describe("createSession", () => {
  it("marks a needs-free job's lane ready immediately", () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`);
    expect(Object.keys(s.lanes)).toEqual(["build::default"]);
    expect(s.lanes["build::default"].status).toBe("ready");
  });

  it("creates one lane per matrix combination", () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [16, 18]
    steps:
      - run: echo hi
`);
    expect(Object.keys(s.lanes).sort()).toEqual(["build::node:16", "build::node:18"].sort());
  });

  it("leaves a job with unmet needs blocked", () => {
    const s = session(`
jobs:
  a: { runs-on: ubuntu-latest, steps: [{ run: echo a }] }
  b: { needs: a, runs-on: ubuntu-latest, steps: [{ run: echo b }] }
`);
    expect(s.lanes["b::default"].status).toBe("blocked");
  });

  it("finalizes a zero-step job as an immediate success instead of deadlocking", async () => {
    // Regression test: a lane with no steps never hit finishStepAdvance (the
    // only place that marks a lane terminal), so it stayed "running" forever
    // and every job that `needs:` it stayed "blocked" forever. Stepping such
    // a lane also crashed with a 500 (lane.steps[0] was undefined).
    const s = session(`
jobs:
  empty:
    runs-on: ubuntu-latest
    steps: []
  after:
    needs: empty
    runs-on: ubuntu-latest
    steps:
      - run: echo after-ran
`);
    expect(s.lanes["empty::default"].status).toBe("success");
    expect(s.lanes["empty::default"].jobResult).toBe("success");
    expect(s.lanes["after::default"].status).toBe("ready");

    const record = await controlStep(s, "after::default");
    expect(record.stdout).toContain("after-ran");
  });
});

describe("controlStep", () => {
  it("executes exactly one step and pauses", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: one
        run: echo step-one
      - name: two
        run: echo step-two
`);
    const first = await controlStep(s, "build::default");
    expect(first.name).toBe("one");
    expect(first.conclusion).toBe("success");
    expect(first.stdout).toContain("step-one");
    expect(s.lanes["build::default"].status).toBe("paused");
    expect(s.lanes["build::default"].pointer).toBe(1);

    const second = await controlStep(s, "build::default");
    expect(second.name).toBe("two");
    expect(s.lanes["build::default"].status).toBe("success");
    expect(s.lanes["build::default"].jobResult).toBe("success");
  });

  it("rejects a second concurrent step on the same lane instead of double-executing it", async () => {
    // Regression test: two overlapping controlStep() calls on one lane used
    // to both pass the status guard (neither "blocked" nor terminal) and
    // both execute the same step, silently double-running its side effects
    // and leaving the pointer one step behind where it should be.
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo one
      - run: echo two
`);
    const results = await Promise.allSettled([
      controlStep(s, "build::default"),
      controlStep(s, "build::default"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(EngineError);
    expect(s.lanes["build::default"].pointer).toBe(1);
  });
});

describe("breakpoints", () => {
  it("continue() stops right before the breakpointed step, and a second continue() runs through", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo a
      - id: b
        run: echo b
      - run: echo c
`);
    setBreakpoint(s, "build", "b", true);
    await controlContinue(s, "build::default");
    const lane = s.lanes["build::default"];
    expect(lane.status).toBe("paused");
    expect(lane.pointer).toBe(1);
    expect(lane.steps[0].conclusion).toBe("success");
    expect(lane.steps[1].status).toBe("pending");

    await controlContinue(s, "build::default");
    expect(lane.status).toBe("success");
    expect(lane.steps[1].conclusion).toBe("success");
    expect(lane.steps[2].conclusion).toBe("success");
  });
});

describe("needs gating and job-level if", () => {
  it("skips a dependent job by default when its need fails, but runs if: always()", async () => {
    const s = session(`
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
  b:
    needs: a
    runs-on: ubuntu-latest
    steps:
      - run: echo b-ran
  c:
    needs: a
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: echo c-ran
`);
    await controlRunAll(s);
    expect(s.lanes["a::default"].jobResult).toBe("failure");
    expect(s.lanes["b::default"].status).toBe("skipped");
    expect(s.lanes["b::default"].steps[0].status).toBe("skipped");
    expect(s.lanes["c::default"].status).toBe("success");
    expect(s.lanes["c::default"].steps[0].stdout).toContain("c-ran");
  });

  it("honors a bare YAML boolean/number if: instead of ignoring it", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    if: false
    steps:
      - run: echo should-not-run
        if: 0
`);
    await controlRunAll(s);
    const lane = s.lanes["build::default"];
    expect(lane.status).toBe("skipped");
    expect(lane.steps[0].status).toBe("skipped");
  });

  it("skips a dependent job by default when its need was itself skipped, not just failed", async () => {
    const s = session(`
jobs:
  a:
    runs-on: ubuntu-latest
    if: false
    steps:
      - run: echo a-ran
  b:
    needs: a
    runs-on: ubuntu-latest
    steps:
      - run: echo b-ran
  c:
    needs: b
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: echo c-ran
`);
    await controlRunAll(s);
    expect(s.lanes["a::default"].status).toBe("skipped");
    expect(s.lanes["b::default"].status).toBe("skipped");
    expect(s.lanes["b::default"].steps[0].status).toBe("skipped");
    expect(s.lanes["c::default"].status).toBe("success");
    expect(s.lanes["c::default"].steps[0].stdout).toContain("c-ran");
  });
});

describe("strategy.fail-fast", () => {
  it("cancels sibling matrix lanes by default when one combination fails", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [16, 18]
    steps:
      - run: |
          if [ "\${{ matrix.node }}" = "16" ]; then exit 1; fi
      - run: echo second-step
`);
    await controlRunAll(s);
    expect(s.lanes["build::node:16"].jobResult).toBe("failure");
    expect(s.lanes["build::node:18"].status).toBe("cancelled");
    expect(s.lanes["build::node:18"].jobResult).toBe("cancelled");
    expect(s.lanes["build::node:18"].steps.every((st) => st.conclusion !== "success")).toBe(true);
  });

  it("does not cancel siblings when fail-fast is explicitly false", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [16, 18]
    steps:
      - run: |
          if [ "\${{ matrix.node }}" = "16" ]; then exit 1; fi
`);
    await controlRunAll(s);
    expect(s.lanes["build::node:16"].jobResult).toBe("failure");
    expect(s.lanes["build::node:18"].jobResult).toBe("success");
  });

  it("cancels a sibling lane mid-flight via manual stepping too, not just Run All", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [16, 18]
    steps:
      - run: |
          if [ "\${{ matrix.node }}" = "16" ]; then exit 1; fi
      - run: echo second-step
`);
    // Manually drive only the failing lane to completion; its sibling should
    // still get cancelled without ever being stepped itself.
    await controlStep(s, "build::node:16");
    await controlStep(s, "build::node:16");
    expect(s.lanes["build::node:16"].jobResult).toBe("failure");
    expect(s.lanes["build::node:18"].status).toBe("cancelled");
  });
});

describe("timeout-minutes", () => {
  it("enforces a step's timeout-minutes instead of discarding it", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: sleep 30
        timeout-minutes: 0.005
`);
    const record = await controlStep(s, "build::default");
    expect(record.engineError).toBe("Step timed out");
    expect(record.outcome).toBe("failure");
  }, 10000);
});

describe("continue-on-error and status functions", () => {
  it("lets success() see past a continue-on-error failure, and failure() see past it too", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
        continue-on-error: true
      - name: guarded
        if: success()
        run: echo should-run
      - name: fallback
        if: failure()
        run: echo should-not-run
`);
    await controlRunAll(s);
    const lane = s.lanes["build::default"];
    expect(lane.steps[0].outcome).toBe("failure");
    expect(lane.steps[0].conclusion).toBe("success");
    expect(lane.steps[1].status).toBe("success");
    expect(lane.steps[1].stdout).toContain("should-run");
    expect(lane.steps[2].status).toBe("skipped");
  });
});

describe("what-if overrides", () => {
  it("applies env overrides to the next executed step", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo $GREETING
`);
    applyWhatIf(s, { env: { GREETING: "hello-whatif" } });
    const record = await controlStep(s, "build::default");
    expect(record.stdout).toContain("hello-whatif");
  });

  it("removes an override when its key is patched to null instead of it being stuck forever", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "[$GREETING]"
`);
    applyWhatIf(s, { env: { GREETING: "hello-whatif" } });
    expect(s.config.envOverrides.GREETING).toBe("hello-whatif");
    applyWhatIf(s, { env: { GREETING: null } });
    expect(s.config.envOverrides.GREETING).toBeUndefined();
    const record = await controlStep(s, "build::default");
    expect(record.stdout).toContain("[]");
  });
});

describe("runner context fidelity", () => {
  it("derives runner.os from runs-on instead of hardcoding Linux", async () => {
    const s = session(`
jobs:
  build:
    runs-on: windows-latest
    steps:
      - run: echo "\${{ runner.os }}"
`);
    const record = await controlStep(s, "build::default");
    expect(record.stdout).toContain("Windows");
  });

  it("keeps runner.temp and $RUNNER_TEMP as the same real, persistent-per-lane directory", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo "expr=\${{ runner.temp }}" >> "$GITHUB_OUTPUT"
          echo "env=$RUNNER_TEMP" >> "$GITHUB_OUTPUT"
          touch "$RUNNER_TEMP/marker"
      - run: |
          echo "still-there=$(test -f "$RUNNER_TEMP/marker" && echo yes || echo no)" >> "$GITHUB_OUTPUT"
`);
    await controlStep(s, "build::default");
    const record2 = await controlStep(s, "build::default");
    const lane = s.lanes["build::default"];
    expect(lane.steps[0].outputs.expr).toBe(lane.steps[0].outputs.env);
    expect(lane.steps[0].outputs.expr).toBe(lane.tempDir);
    expect(record2.outputs["still-there"]).toBe("yes");
  });
});

describe("well-known context fields", () => {
  it("seeds secrets.GITHUB_TOKEN and masks it like any other secret", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "token=\${{ secrets.GITHUB_TOKEN }}"
`);
    const record = await controlStep(s, "build::default");
    expect(record.stdout).not.toContain("local-debug-github-token");
    expect(record.stdout).toContain("***");
  });

  it("derives head_ref/base_ref from the pull_request event payload, empty otherwise", async () => {
    const push = session(`
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "head=[\${{ github.head_ref }}] base=[\${{ github.base_ref }}]"
`);
    const pushRecord = await controlStep(push, "build::default");
    expect(pushRecord.stdout).toContain("head=[] base=[]");

    const pr = session(`
on: pull_request
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "head=[\${{ github.head_ref }}] base=[\${{ github.base_ref }}]"
`);
    const prRecord = await controlStep(pr, "build::default");
    expect(prRecord.stdout).toContain("head=[feature-branch] base=[main]");
  });

  it("derives repository_owner, ref_type, and triggering_actor instead of leaving them null", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "owner=\${{ github.repository_owner }} type=\${{ github.ref_type }} who=\${{ github.triggering_actor }}"
`);
    const record = await controlStep(s, "build::default");
    expect(record.stdout).toContain("owner=local type=branch who=local-debugger");
  });
});

describe("step outputs", () => {
  it("flows $GITHUB_OUTPUT into a later step's expression", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: gen
        run: echo "value=42" >> "$GITHUB_OUTPUT"
      - run: echo "got \${{ steps.gen.outputs.value }}"
`);
    await controlStep(s, "build::default");
    const second = await controlStep(s, "build::default");
    expect(second.stdout).toContain("got 42");
  });

  it("does not expose an id-less step under its synthetic key in the steps context", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "no id here"
      - id: named
        run: echo "has an id"
      - run: echo "dump=\${{ toJSON(steps) }}"
`);
    await controlStep(s, "build::default");
    await controlStep(s, "build::default");
    const third = await controlStep(s, "build::default");
    // The id-less first step must not leak in under its internal step-0
    // key - only the explicitly-id'd step is real, addressable context.
    expect(third.stdout).not.toContain("step-0");
    expect(third.stdout).toContain("named");
  });
});

describe("secret masking", () => {
  it("masks secret values in captured stdout", async () => {
    const s = session(
      `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "token is $TOKEN"
        env:
          TOKEN: \${{ secrets.TOKEN }}
`,
      { secrets: { TOKEN: "supersecretvalue123" } }
    );
    const record = await controlStep(s, "build::default");
    expect(record.stdout).not.toContain("supersecretvalue123");
    expect(record.stdout).toContain("***");
  });

  it("masks secrets in combinedOutput too, not just the split stdout/stderr fields", async () => {
    const s = session(
      `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "token is $TOKEN" 1>&2
        env:
          TOKEN: \${{ secrets.TOKEN }}
`,
      { secrets: { TOKEN: "supersecretvalue123" } }
    );
    const record = await controlStep(s, "build::default");
    const combinedText = record.combinedOutput.map((c) => c.text).join("");
    expect(combinedText).not.toContain("supersecretvalue123");
    expect(combinedText).toContain("***");
  });
});

describe("simulated uses: steps", () => {
  it("marks uses steps as simulated with an explanatory note", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: some-org/some-action@v1
`);
    const first = await controlStep(s, "build::default");
    expect(first.simulated).toBe(true);
    // Updated to match the clarified empty-scratch-workspace wording
    expect(first.simulationNote).toContain("empty scratch workspace");
    expect(first.simulationNote).toContain("no files are checked out");
    const second = await controlStep(s, "build::default");
    expect(second.simulated).toBe(true);
    expect(second.simulationNote).toContain("isn't executed locally");
  });

  it("masks secrets that a handler echoes back into its simulation note", async () => {
    // Regression test: simulatedActions handlers can legitimately echo a
    // `with:` input value into their note (e.g. a version string or a
    // registry username) - if that input was sourced from `secrets.*`, the
    // note must be masked exactly like stdout/stderr/outputs are.
    const s = session(
      `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ secrets.NODE_VERSION }}
`,
      { secrets: { NODE_VERSION: "totally-secret-node-version-value" } }
    );
    const record = await controlStep(s, "build::default");
    expect(record.simulationNote).not.toContain("totally-secret-node-version-value");
    expect(record.simulationNote).toContain("***");
  });
});

describe("mock outputs for uses: steps", () => {
  it("merges a mock on top of the simulated outputs and flags which keys were mocked", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: cache
        uses: actions/cache@v4
`);
    setMockOutputs(s, "build", "cache", { outputs: { "cache-hit": "true" } });
    const record = await controlStep(s, "build::default");
    expect(record.outputs["cache-hit"]).toBe("true");
    expect(record.mockedOutputKeys).toEqual(["cache-hit"]);
  });

  it("adds a mock key that the simulator never produces", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: login
        uses: docker/login-action@v3
`);
    setMockOutputs(s, "build", "login", { outputs: { "session-token": "fake-token" } });
    const record = await controlStep(s, "build::default");
    expect(record.outputs["session-token"]).toBe("fake-token");
  });

  it("leaves unmocked steps and unmocked keys untouched", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
`);
    const record = await controlStep(s, "build::default");
    expect(record.mockedOutputKeys).toBeUndefined();
    expect(record.outputs["node-version"]).toBe("20");
  });

  it("flows a mocked output into a later step's expression", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: cache
        uses: actions/cache@v4
      - run: echo "hit=\${{ steps.cache.outputs['cache-hit'] }}"
`);
    setMockOutputs(s, "build", "cache", { outputs: { "cache-hit": "true" } });
    await controlStep(s, "build::default");
    const second = await controlStep(s, "build::default");
    expect(second.stdout).toContain("hit=true");
  });

  it("clears a mock when set to null, reverting to the simulated output", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: cache
        uses: actions/cache@v4
`);
    setMockOutputs(s, "build", "cache", { outputs: { "cache-hit": "true" } });
    setMockOutputs(s, "build", "cache", null);
    const record = await controlStep(s, "build::default");
    expect(record.outputs["cache-hit"]).toBe("false");
    expect(record.mockedOutputKeys).toBeUndefined();
  });

  it("masks a mock value that happens to equal a configured secret", async () => {
    const s = session(
      `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: login
        uses: docker/login-action@v3
`,
      { secrets: { TOKEN: "shh-its-a-secret" } }
    );
    setMockOutputs(s, "build", "login", { outputs: { token: "shh-its-a-secret" } });
    const record = await controlStep(s, "build::default");
    expect(record.outputs.token).toBe("***");
  });
});

describe("mocking a run: step's outcome", () => {
  it("does not execute a mocked run: step", async () => {
    const marker = path.join(workspaceDir, "should-not-exist");
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: touch
        run: touch ${marker}
`);
    setMockOutputs(s, "build", "touch", { outputs: { done: "yes" } });
    const record = await controlStep(s, "build::default");
    await expect(fs.stat(marker)).rejects.toThrow();
    expect(record.simulated).toBe(true);
    expect(record.simulationNote).toContain("Mocked");
    expect(record.outputs.done).toBe("yes");
  });

  it("turns a run: step into a failure with the given exit code and stderr", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: test
        run: exit 0
`);
    setMockOutputs(s, "build", "test", { outputs: {}, exitCode: 2, stderr: "2 tests failed" });
    const record = await controlStep(s, "build::default");
    expect(record.exitCode).toBe(2);
    expect(record.outcome).toBe("failure");
    expect(record.conclusion).toBe("failure");
    expect(record.stderr).toBe("2 tests failed");
    expect(record.combinedOutput).toEqual([{ stream: "stderr", text: "2 tests failed" }]);
  });

  it("masks a secret that appears in mocked stderr", async () => {
    const s = session(
      `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: deploy
        run: echo deploying
`,
      { secrets: { TOKEN: "hunter2" } }
    );
    setMockOutputs(s, "build", "deploy", { outputs: {}, exitCode: 1, stderr: "bad token hunter2" });
    const record = await controlStep(s, "build::default");
    expect(record.stderr).toBe("bad token ***");
  });

  it("lets continue-on-error absorb a mocked failure, as it would a real one", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: flaky
        run: echo ok
        continue-on-error: true
`);
    setMockOutputs(s, "build", "flaky", { outputs: {}, exitCode: 1 });
    const record = await controlStep(s, "build::default");
    expect(record.outcome).toBe("failure");
    expect(record.conclusion).toBe("success");
    expect(s.lanes["build::default"].status).not.toBe("failure");
  });

  it("drives a later 'if: failure()' step from a mocked failure", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: test
        run: echo ok
      - if: failure()
        run: echo 'collecting logs'
`);
    setMockOutputs(s, "build", "test", { outputs: {}, exitCode: 1 });
    s.breakOnFailure = false;
    await controlStep(s, "build::default");
    const cleanup = await controlStep(s, "build::default");
    expect(cleanup.ifResult).toBe(true);
    expect(cleanup.stdout).toContain("collecting logs");
  });

  it("mocks a run: step's outputs without forcing an outcome", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: version
        run: echo "v=1.0.0" >> $GITHUB_OUTPUT
`);
    setMockOutputs(s, "build", "version", { outputs: { v: "9.9.9" } });
    const record = await controlStep(s, "build::default");
    expect(record.outputs.v).toBe("9.9.9");
    expect(record.outcome).toBe("success");
  });

  it("treats a mock that changes nothing as no mock at all", async () => {
    const marker = path.join(workspaceDir, "ran");
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: touch
        run: touch ${marker}
`);
    setMockOutputs(s, "build", "touch", { outputs: { done: "yes" } });
    // Emptying the last row is how the editor says "no mock" - an exit code
    // of 0 with nothing else says the same thing, so neither may leave a
    // husk of a mock behind that still suppresses execution.
    setMockOutputs(s, "build", "touch", { outputs: {}, exitCode: 0 });
    expect(s.mockOutputs["build:touch"]).toBeUndefined();
    const record = await controlStep(s, "build::default");
    await expect(fs.stat(marker)).resolves.toBeTruthy();
    expect(record.simulated).toBeFalsy();
  });
});

describe("real working-tree sessions", () => {
  let realDir: string;

  beforeEach(async () => {
    realDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-test-real-repo-"));
  });

  afterEach(async () => {
    await fs.rm(realDir, { recursive: true, force: true });
  });

  function realSession(yaml: string): DebugSession {
    const { workflow, issues } = parseWorkflow(yaml);
    const blocking = issues.filter((i) => i.severity === "error");
    if (!workflow || blocking.length > 0) {
      throw new Error(`fixture failed to parse: ${JSON.stringify(blocking)}`);
    }
    const s = createSession({
      workflow,
      workspaceDir: realDir,
      usesRealWorkspace: true,
      ownerId: "test-owner",
    });
    createdSessionIds.push(s.id);
    return s;
  }

  it("runs a run: step for real against the chosen directory, and github.workspace/$GITHUB_WORKSPACE reflect it", async () => {
    const s = realSession(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "$GITHUB_WORKSPACE" > out.txt
`);
    const record = await controlStep(s, "build::default");
    expect(record.simulated).toBeFalsy();
    expect(await fs.readFile(path.join(realDir, "out.txt"), "utf8")).toBe(`${realDir}\n`);
  });

  it("keeps simulated-action artifact scratch space out of the real working tree", async () => {
    const s = realSession(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: out.txt
`);
    await fs.writeFile(path.join(realDir, "out.txt"), "hi");
    await controlStep(s, "build::default");
    // The debugger must never create its own scratch dirs inside a real repo.
    await expect(fs.stat(path.join(realDir, ".debugger"))).rejects.toThrow();
  });
});

describe("session.parseIssues", () => {
  it("carries parse warnings onto the session instead of losing them after creation", () => {
    const { workflow } = parseWorkflow(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps: []
`);
    const issues = [{ severity: "warning" as const, message: "jobs.build.steps is empty" }];
    const s = createSession({ workflow: workflow!, workspaceDir, ownerId: "test-owner", parseIssues: issues });
    createdSessionIds.push(s.id);
    expect(s.parseIssues).toEqual(issues);
  });

  it("defaults to an empty list when no parse issues are given", () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`);
    expect(s.parseIssues).toEqual([]);
  });
});

describe("session.revision", () => {
  it("bumps on every mutating operation, not just when a lane's pointer moves", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo one
      - run: echo two
`);
    const seen: number[] = [s.revision];

    setBreakpoint(s, "build", "step-1", true);
    seen.push(s.revision);

    setMockOutputs(s, "build", "step-0", null);
    seen.push(s.revision);

    applyWhatIf(s, { env: { FOO: "bar" } });
    seen.push(s.revision);

    await controlStep(s, "build::default");
    seen.push(s.revision);

    await controlContinue(s, "build::default");
    seen.push(s.revision);

    // Strictly increasing - every operation above mutated the session.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    }
  });
});

describe("simulation-only mode", () => {
  const original = process.env.VIZU_DEMO_MODE;
  beforeEach(() => {
    process.env.VIZU_DEMO_MODE = "1";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.VIZU_DEMO_MODE;
    else process.env.VIZU_DEMO_MODE = original;
  });

  it("never spawns a run: step, even one with an observable side effect", async () => {
    // A real spawn would create this file; its absence is the proof that
    // nothing ran, rather than just trusting the reported status.
    const marker = path.join(workspaceDir, "proof-of-execution");
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: touch ${marker}
`);
    const record = await controlStep(s, "build::default");

    await expect(fs.stat(marker)).rejects.toThrow();
    expect(record.simulated).toBe(true);
    expect(record.outcome).toBe("success");
    expect(record.simulationNote).toContain("simulation-only");
  });

  it("shows the interpolated command, which is the part worth seeing", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18]
    steps:
      - run: echo "building on node \${{ matrix.node }}"
`);
    const record = await controlStep(s, "build::node:18");
    expect(record.simulationNote).toContain("building on node 18");
  });

  it("masks secrets that interpolation pulled into the command", async () => {
    const s = session(
      `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: deploy --token \${{ secrets.TOKEN }}
`,
      { secrets: { TOKEN: "s3cret-token-value" } }
    );
    const record = await controlStep(s, "build::default");
    expect(record.simulationNote).not.toContain("s3cret-token-value");
    expect(record.simulationNote).toContain("***");
  });

  it("still evaluates if: conditions normally, so branches remain debuggable", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo always
      - if: false
        run: echo never
`);
    await controlStep(s, "build::default");
    const skipped = await controlStep(s, "build::default");
    expect(skipped.status).toBe("skipped");
  });
});

describe("expansion limits", () => {
  function axesYaml(axisCount: number, size: number): string {
    const axes = Array.from(
      { length: axisCount },
      (_, i) => `        axis${i}: [${Array.from({ length: size }, (_, j) => j).join(", ")}]`
    ).join("\n");
    return `name: big
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
${axes}
    steps:
      - run: echo hi
`;
  }

  it("refuses a matrix over GitHub's own 256-combination limit", () => {
    // 10 axes of 10 values: a few lines of YAML, ten billion combinations.
    expect(() => session(axesYaml(10, 10))).toThrow(EngineError);
    expect(() => session(axesYaml(10, 10))).toThrow(/more than 256 combinations/);
  });

  it("rejects it quickly rather than expanding to find out", () => {
    const started = Date.now();
    expect(() => session(axesYaml(10, 10))).toThrow();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("still accepts a matrix at the limit", () => {
    const s = session(axesYaml(8, 2)); // 2^8 = 256
    expect(s.laneOrder).toHaveLength(256);
  });

  it("refuses a workflow whose jobs together exceed the total lane budget", () => {
    const jobs = Array.from(
      { length: 4 },
      (_, i) => `  job${i}:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [${Array.from({ length: 16 }, (_, j) => j).join(", ")}]
        b: [${Array.from({ length: 16 }, (_, j) => j).join(", ")}]
    steps:
      - run: echo hi`
    ).join("\n");
    // 4 jobs x 256 lanes = 1024, each matrix legal on its own.
    expect(() => session(`name: many\non: [push]\n\njobs:\n${jobs}\n`)).toThrow(
      /more than 512 matrix lanes/
    );
  });
});

describe("secret masking in error paths", () => {
  const SECRET = "super-secret-token-value";

  it("masks a secret quoted back by a failing `if:` expression", async () => {
    const s = session(
      `name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: broken
        if: fromJSON(secrets.TOKEN)
        run: echo hi
`,
      { secrets: { TOKEN: SECRET } }
    );
    const record = await controlStep(s, s.laneOrder[0]);
    expect(record.ifError).toBeTruthy();
    expect(record.ifError).not.toContain(SECRET);
    expect(record.ifError).toContain("***");
  });

  it("masks a secret quoted back by a failing `run:` interpolation", async () => {
    const s = session(
      `name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: broken
        run: echo "\${{ fromJSON(secrets.TOKEN) }}"
`,
      { secrets: { TOKEN: SECRET } }
    );
    const record = await controlStep(s, s.laneOrder[0]);
    expect(record.engineError).toBeTruthy();
    expect(record.engineError).not.toContain(SECRET);
    expect(record.engineError).toContain("***");
  });
});
