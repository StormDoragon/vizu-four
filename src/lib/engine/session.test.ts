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
  const s = createSession({ workflow, workspaceDir, config });
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
    setMockOutputs(s, "build", "cache", { "cache-hit": "true" });
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
    setMockOutputs(s, "build", "login", { "session-token": "fake-token" });
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
    setMockOutputs(s, "build", "cache", { "cache-hit": "true" });
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
    setMockOutputs(s, "build", "cache", { "cache-hit": "true" });
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
    setMockOutputs(s, "build", "login", { token: "shh-its-a-secret" });
    const record = await controlStep(s, "build::default");
    expect(record.outputs.token).toBe("***");
  });
});
