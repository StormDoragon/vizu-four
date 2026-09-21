import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkflow } from "../workflow/parser";
import {
  applyWhatIf,
  controlContinue,
  controlRunAll,
  controlStep,
  createSession,
  grantExecutionConsent,
  setBreakpoint,
  setMockOutputs,
} from "./session";
import { EngineError } from "./errors";
import { toSessionView } from "./serialize";
import { maskObjectStrings, secretsToMask } from "./masking";
import { resolveEffectiveEnv, sessionTempRoot } from "./contexts";
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
    expect(Object.keys(s.lanes).sort()).toEqual(["build::node:#16", "build::node:#18"].sort());
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
    expect(s.lanes["build::node:#16"].jobResult).toBe("failure");
    expect(s.lanes["build::node:#18"].status).toBe("cancelled");
    expect(s.lanes["build::node:#18"].jobResult).toBe("cancelled");
    expect(s.lanes["build::node:#18"].steps.every((st) => st.conclusion !== "success")).toBe(true);
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
    expect(s.lanes["build::node:#16"].jobResult).toBe("failure");
    expect(s.lanes["build::node:#18"].jobResult).toBe("success");
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
    await controlStep(s, "build::node:#16");
    await controlStep(s, "build::node:#16");
    expect(s.lanes["build::node:#16"].jobResult).toBe("failure");
    expect(s.lanes["build::node:#18"].status).toBe("cancelled");
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

describe("accumulated session size", () => {
  const patchOf = (round: number, n: number, chars: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`K${round}_${i}`, "x".repeat(chars)]));

  const tiny = `name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

  it("refuses a patch that would push the session past the key limit", () => {
    // Each of these is individually legal. The limits used to bound only one
    // request, so repeating it grew a session without creating another.
    const s = session(tiny);
    for (let round = 0; round < 5; round++) {
      applyWhatIf(s, { env: patchOf(round, 200, 10) });
    }
    expect(Object.keys(s.config.envOverrides)).toHaveLength(1000);
    expect(() => applyWhatIf(s, { env: patchOf(99, 1, 10) })).toThrow(/more than 1000 keys/);
  });

  it("refuses a patch that would push the session past the character limit", () => {
    const s = session(tiny);
    for (let round = 0; round < 19; round++) {
      applyWhatIf(s, { env: patchOf(round, 1, 100_000) });
    }
    expect(() => applyWhatIf(s, { env: patchOf(99, 1, 100_000) })).toThrow(
      /more than 2000000 characters/
    );
  });

  it("still allows a patch that only removes keys once the limit is reached", () => {
    // Projecting the result rather than measuring the patch is what makes
    // this work - otherwise a session at the limit could never come back
    // under it.
    const s = session(tiny);
    for (let round = 0; round < 5; round++) {
      applyWhatIf(s, { env: patchOf(round, 200, 10) });
    }
    expect(() => applyWhatIf(s, { env: { K0_0: null } })).not.toThrow();
    expect(Object.keys(s.config.envOverrides)).toHaveLength(999);
    // ...and room freed by the delete is usable again.
    expect(() => applyWhatIf(s, { env: patchOf(99, 1, 10) })).not.toThrow();
  });

  it("bounds each map separately rather than in aggregate", () => {
    const s = session(tiny);
    for (let round = 0; round < 5; round++) {
      applyWhatIf(s, { env: patchOf(round, 200, 10) });
    }
    // env is full; vars is untouched and must still accept a patch.
    expect(() => applyWhatIf(s, { vars: patchOf(0, 200, 10) })).not.toThrow();
  });
});

describe("masking never touches live execution state", () => {
  // GitHub masks its logs, not the data flowing between steps. Masking at
  // capture time broke the workflow itself: a step that wrote a secret to
  // `$GITHUB_OUTPUT` handed the next step a literal `***`.
  it("passes a secret-valued step output to the next step unchanged", async () => {
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: producer
        run: echo "value=\${{ secrets.TOKEN }}" >> "$GITHUB_OUTPUT"
      - id: consumer
        run: test "\${{ steps.producer.outputs.value }}" = "the-real-secret-value" && echo SAME || echo DIFFERENT
`, { secrets: { TOKEN: "the-real-secret-value" } });
    const lane = s.laneOrder[0];
    await controlStep(s, lane);
    const consumer = await controlStep(s, lane);
    expect(consumer.stdout).toContain("SAME");

    // ...and the client still never sees it.
    const view = toSessionView(s);
    expect(view.lanes[lane].steps[0].outputs.value).toBe("***");
    expect(JSON.stringify(view.lanes)).not.toContain("the-real-secret-value");
  });

  it("passes a secret-valued job output to a dependent job unchanged", async () => {
    const s = session(`name: t
on: [push]

jobs:
  produce:
    runs-on: ubuntu-latest
    outputs:
      tok: \${{ steps.s.outputs.value }}
    steps:
      - id: s
        run: echo "value=\${{ secrets.TOKEN }}" >> "$GITHUB_OUTPUT"
  consume:
    needs: produce
    runs-on: ubuntu-latest
    steps:
      - run: test "\${{ needs.produce.outputs.tok }}" = "the-real-secret-value" && echo SAME || echo DIFFERENT
`, { secrets: { TOKEN: "the-real-secret-value" } });
    await controlRunAll(s);
    expect(s.lanes["consume::default"].steps[0].stdout).toContain("SAME");

    const view = toSessionView(s);
    expect(view.lanes["produce::default"].outputs.tok).toBe("***");
    expect(JSON.stringify(view.lanes)).not.toContain("the-real-secret-value");
  });
});

describe("truncation never precedes masking", () => {
  // A secret longer than a display cap is the case that matters: truncating
  // first discards exactly the tail a later mask would have matched on, so
  // the head sits in the output unrecognised. Every string below is capped
  // well under this length.
  const LONG_SECRET = `sk-live-${"A".repeat(400)}-end`;
  const leaks = (text: string) => /A{20,}/.test(text);

  it("masks the interpolated command before capping it to one line", async () => {
    const s = session(
      `name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.TOKEN }}"
`,
      { secrets: { TOKEN: LONG_SECRET } }
    );
    // Mocking the step is what routes it through the simulation note, which
    // is where the command gets summarised.
    setMockOutputs(s, "build", "step-0", { outputs: { stubbed: "yes" } });
    const record = await controlStep(s, s.laneOrder[0]);
    expect(record.simulationNote).toBeDefined();
    expect(leaks(record.simulationNote!)).toBe(false);
    expect(record.simulationNote).toContain("***");
  });

  it("masks a github-script input before quoting the start of it back", async () => {
    const s = session(
      `name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const token = "\${{ secrets.TOKEN }}";
`,
      { secrets: { TOKEN: LONG_SECRET } }
    );
    const record = await controlStep(s, s.laneOrder[0]);
    expect(record.simulationNote).toBeDefined();
    expect(leaks(record.simulationNote!)).toBe(false);
    expect(record.simulationNote).toContain("***");
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

  it("resolves a matrix-interpolated runs-on before deriving runner.os", async () => {
    // `runs-on: ${{ matrix.os }}` is how a cross-OS matrix is actually
    // written. Deriving from the literal template matched no label, so every
    // lane reported Linux and the OS branches the matrix exists to exercise
    // all took the same path.
    const s = session(`
jobs:
  build:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - run: echo "\${{ runner.os }}"
`);
    const seen: string[] = [];
    for (const laneId of s.laneOrder) {
      seen.push((await controlStep(s, laneId)).stdout.trim());
    }
    expect(seen.sort()).toEqual(["Linux", "Windows", "macOS"].sort());
  });

  it("falls back to the raw label when runs-on cannot be interpolated", async () => {
    const s = session(`
jobs:
  build:
    runs-on: \${{ nonsense( }}-windows
    steps:
      - run: echo "\${{ runner.os }}"
`);
    const record = await controlStep(s, "build::default");
    expect(record.stdout).toContain("Windows");
  });

  it("keeps a lane's RUNNER_TEMP inside the session temp root", async () => {
    // Matrix values are workflow-author input and land in the lane id, which
    // used to be joined straight into the path: `../../..`-style values
    // resolved the lane's temp directory outside the session root, created it
    // there, and handed it to every step as $RUNNER_TEMP.
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        os: ["../../../../../../tmp/pwned", "plain"]
    steps:
      - run: echo "$RUNNER_TEMP"
`);
    const root = sessionTempRoot(s.id) + path.sep;
    const dirs = s.laneOrder.map((id) => s.lanes[id].tempDir);
    expect(dirs).toHaveLength(2);
    for (const dir of dirs) expect(dir.startsWith(root)).toBe(true);
    // Distinct lanes keep distinct directories through the sanitizing.
    expect(new Set(dirs).size).toBe(2);

    // And the directory the step actually gets is the confined one.
    for (const laneId of s.laneOrder) {
      await controlStep(s, laneId);
      expect(s.lanes[laneId].steps[0].stdout.trim()).toBe(s.lanes[laneId].tempDir);
    }
  });

  it("keeps lanes separate when a matrix value contains the lane-key delimiters", async () => {
    const s = session(`
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: ["x|b:y"]
        include:
          - a: x
            b: y
    steps:
      - run: echo hi
`);
    // Two combinations, so two lanes - not one lane listed twice.
    expect(s.laneOrder).toHaveLength(2);
    expect(new Set(s.laneOrder).size).toBe(2);
    expect(Object.keys(s.lanes)).toHaveLength(2);
    const matrices = s.laneOrder.map((id) => s.lanes[id].matrix);
    expect(matrices).toContainEqual({ a: "x|b:y" });
    expect(matrices).toContainEqual({ a: "x", b: "y" });

    // Stepping one must not advance the other.
    await controlStep(s, s.laneOrder[0]);
    expect(s.lanes[s.laneOrder[0]].pointer).toBe(1);
    expect(s.lanes[s.laneOrder[1]].pointer).toBe(0);
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
    // The engine keeps the real value, because a later step reads this back
    // through `steps.login.outputs.token` - masking here would hand it
    // `***`. What matters is that the client never sees it.
    expect(record.outputs.token).toBe("shh-its-a-secret");
    const view = toSessionView(s);
    expect(view.lanes["build::default"].steps[0].outputs.token).toBe("***");
    // Lane state specifically: `mockOutputs` deliberately still carries the
    // value, because that is the owner's own mock configuration being echoed
    // back to the editor they typed it into, not captured execution output.
    expect(JSON.stringify(view.lanes)).not.toContain("shh-its-a-secret");
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
    const record = await controlStep(s, "build::node:#18");
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

  it("accepts a full 256-combination matrix carrying a merging include", () => {
    const axes = Array.from({ length: 8 }, (_, i) => `        a${i}: [0, 1]`).join("\n");
    const s = session(`name: ok
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
${axes}
        include:
          - a0: 0
            extra: flag
    steps:
      - run: echo hi
`);
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
  });

  it("does not leak a secret longer than any message-truncation cutoff", async () => {
    // Masking searches for the secret's full text, so a value truncated to
    // fit an error message leaves an unmatchable prefix. A short secret used
    // to pass this while a long one printed most of itself back.
    const LONG = `review-token-${"x".repeat(200)}`;
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
      { secrets: { TOKEN: LONG } }
    );
    const record = await controlStep(s, s.laneOrder[0]);
    expect(record.ifError).toBeTruthy();
    expect(record.ifError).not.toContain("review-token-xxxx");
    expect(record.ifError).not.toContain(LONG.slice(0, 30));
  });
});

describe("implicit success() gate on explicit if:", () => {
  // GitHub applies a default success() check to any `if:` that doesn't name
  // a status function, so an ordinary condition does NOT run after a failure.
  function afterFailure(ifExpr: string): string {
    return `name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: boom
        run: exit 1
      - name: after
        if: ${ifExpr}
        run: echo hi
`;
  }

  async function outcomeOfSecondStep(ifExpr: string) {
    const s = session(afterFailure(ifExpr));
    await controlRunAll(s);
    return s.lanes[s.laneOrder[0]].steps[1];
  }

  it("skips `if: true` after a failed step", async () => {
    expect((await outcomeOfSecondStep("true")).conclusion).toBe("skipped");
  });

  it("skips an ordinary context comparison after a failed step", async () => {
    expect((await outcomeOfSecondStep("github.ref == 'refs/heads/main'")).conclusion).toBe(
      "skipped"
    );
  });

  it("runs `if: failure()` after a failed step", async () => {
    expect((await outcomeOfSecondStep("failure()")).conclusion).toBe("success");
  });

  it("runs `if: always()` after a failed step", async () => {
    expect((await outcomeOfSecondStep("always()")).conclusion).toBe("success");
  });

  it("runs a status function combined with another condition", async () => {
    expect((await outcomeOfSecondStep("always() && true")).conclusion).toBe("success");
  });

  it("does not count the word success() inside a string literal", async () => {
    expect((await outcomeOfSecondStep("contains('success()', 'x')")).conclusion).toBe("skipped");
  });

  it("detects a negated status function, which the warning tells people to use", async () => {
    // A bare leading `!` is a YAML tag, so this must carry the ${{ }} wrapper -
    // which is exactly what the warning text tells the user to write.
    expect((await outcomeOfSecondStep("${{ !cancelled() }}")).conclusion).toBe("success");
    expect((await outcomeOfSecondStep("\"!cancelled()\"")).conclusion).toBe("success");
  });

  it("explains why a true condition was skipped anyway", async () => {
    const record = await outcomeOfSecondStep("true");
    expect(record.ifWarning).toMatch(/default\s+success\(\) check/);
    expect(record.ifWarning).toMatch(/failure\(\) runs it only when something failed/);
  });

  it("leaves an explicit if: alone when nothing failed", async () => {
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: fine
        run: echo ok
      - name: after
        if: true
        run: echo hi
`);
    await controlRunAll(s);
    const record = s.lanes[s.laneOrder[0]].steps[1];
    expect(record.conclusion).toBe("success");
    expect(record.ifWarning).toBeUndefined();
  });

  it("does not trip the gate on a continue-on-error failure", async () => {
    // continue-on-error turns the failure into a "success" conclusion, so
    // nothing has actually failed as far as the default gate is concerned.
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: tolerated
        continue-on-error: true
        run: exit 1
      - name: after
        if: true
        run: echo hi
`);
    await controlRunAll(s);
    expect(s.lanes[s.laneOrder[0]].steps[1].conclusion).toBe("success");
  });

  it("skips a downstream job whose explicit if: has no status function", async () => {
    const s = session(`name: t
on: [push]

jobs:
  first:
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
  second:
    needs: [first]
    if: true
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`);
    await controlRunAll(s);
    const secondLane = s.laneOrder.map((id) => s.lanes[id]).find((l) => l.jobId === "second");
    expect(secondLane?.jobResult).toBe("skipped");
  });

  it("runs a downstream job with if: always() after a failed dependency", async () => {
    const s = session(`name: t
on: [push]

jobs:
  first:
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
  second:
    needs: [first]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`);
    await controlRunAll(s);
    const secondLane = s.laneOrder.map((id) => s.lanes[id]).find((l) => l.jobId === "second");
    expect(secondLane?.jobResult).toBe("success");
  });
});

describe("a throwing step does not wedge the lane", () => {
  it("records the error and leaves the lane steppable", async () => {
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: explodes
        uses: actions/upload-artifact@v4
        with:
          name: x
          path: "**"
      - name: after
        if: always()
        run: echo hi
`);
    const mod = await import("./simulatedActions");
    const spy = vi.spyOn(mod, "runSimulatedAction").mockImplementation(() => {
      throw new Error("boom from inside the handler");
    });

    try {
      const record = await controlStep(s, s.laneOrder[0]);
      expect(record.conclusion).toBe("failure");
      expect(record.engineError).toContain("boom from inside the handler");
    } finally {
      spy.mockRestore();
    }

    // "running" is the one status with no way out - the lane must not be left
    // in it, or every later control call rejects it as already running.
    expect(s.lanes[s.laneOrder[0]].status).not.toBe("running");
    const next = await controlStep(s, s.laneOrder[0]);
    expect(next.name).toBe("after");
    expect(next.conclusion).toBe("success");
  });

  it("masks secrets in an engine error", async () => {
    const s = session(
      `name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: explodes
        uses: actions/upload-artifact@v4
        with:
          name: x
          path: "**"
`,
      { secrets: { TOKEN: "super-secret-token-value" } }
    );
    const mod = await import("./simulatedActions");
    const spy = vi.spyOn(mod, "runSimulatedAction").mockImplementation(() => {
      throw new Error("failed writing super-secret-token-value to disk");
    });

    try {
      const record = await controlStep(s, s.laneOrder[0]);
      expect(record.engineError).not.toContain("super-secret-token-value");
      expect(record.engineError).toContain("***");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("secrets written into GITHUB_ENV / GITHUB_PATH", () => {
  const SECRET = "review-secret-value";

  it("masks them in the serialized session but keeps them usable by later steps", async () => {
    const s = session(
      `name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: export
        run: |
          echo "LEAKED=\${{ secrets.TOKEN }}" >> "$GITHUB_ENV"
          echo "/opt/\${{ secrets.TOKEN }}/bin" >> "$GITHUB_PATH"
      - name: read it back
        run: echo "value is $LEAKED"
`,
      { secrets: { TOKEN: SECRET } }
    );
    await controlStep(s, s.laneOrder[0]);

    // The engine keeps the real value: the next step has to run against it.
    expect(s.lanes[s.laneOrder[0]].env.LEAKED).toBe(SECRET);

    const view = toSessionView(s);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(view.lanes[s.laneOrder[0]].env.LEAKED).toBe("***");
    expect(view.lanes[s.laneOrder[0]].extraPath[0]).toBe("/opt/***/bin");

    // And the later step still resolved the real value, masked on the way out.
    const second = await controlStep(s, s.laneOrder[0]);
    expect(second.stdout).toContain("***");
    expect(second.stdout).not.toContain(SECRET);
  });
});

describe("shared sessions need consent before executing", () => {
  function sharedSession() {
    const { workflow } = parseWorkflow(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`);
    const s = createSession({
      workflow: workflow!,
      workspaceDir,
      ownerId: "test-owner",
      awaitingExecutionConsent: true,
    });
    createdSessionIds.push(s.id);
    return s;
  }

  it("refuses every control path until consent is given", async () => {
    const s = sharedSession();
    const lane = s.laneOrder[0];
    await expect(controlStep(s, lane)).rejects.toThrow(EngineError);
    await expect(controlContinue(s, lane)).rejects.toThrow(/hasn't been allowed to run/);
    await expect(controlRunAll(s)).rejects.toThrow(/hasn't been allowed to run/);
    expect(s.lanes[lane].steps[0].status).toBe("pending");
  });

  it("runs once consent is granted", async () => {
    const s = sharedSession();
    grantExecutionConsent(s);
    const record = await controlStep(s, s.laneOrder[0]);
    expect(record.conclusion).toBe("success");
  });

  it("does not gate a session the visitor created themselves", async () => {
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`);
    expect(s.awaitingExecutionConsent).toBe(false);
    await expect(controlStep(s, s.laneOrder[0])).resolves.toBeTruthy();
  });
});

describe("historical environment snapshots", () => {
  /** What the context route serves for `stepIndex=K` - the state entering
   * step K, historical once that step has run. Mirrors the route, including
   * applying the pending step's own `env:` on the live path. */
  function envAt(s: DebugSession, laneId: string, stepIndex: number): Record<string, string> {
    const lane = s.lanes[laneId];
    const recorded = stepIndex < lane.pointer ? lane.steps[stepIndex]?.envBefore : undefined;
    const pendingStepEnv = s.workflow.jobs[lane.jobId]?.steps[stepIndex]?.env;
    return recorded ?? resolveEffectiveEnv(s, lane, stepIndex, pendingStepEnv);
  }

  /** What the context route serves for `afterStepIndex=N` - what step N left
   * behind, falling back to the live view when it has not run. */
  function envAfter(s: DebugSession, laneId: string, n: number): Record<string, string> {
    const lane = s.lanes[laneId];
    const recorded = n >= 0 && n < lane.pointer ? lane.steps[n]?.envAfter : undefined;
    const upto = Math.max(0, Math.min(n + 1, lane.pointer));
    return recorded ?? resolveEffectiveEnv(s, lane, upto, undefined);
  }

  const COLOR_WORKFLOW = `name: t
on: [push]
env:
  COLOR: red

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: sees red
        run: echo "$COLOR"
      - name: writes blue
        run: echo "COLOR=blue" >> "$GITHUB_ENV"
      - name: sees blue
        run: echo "$COLOR"
`;

  it("keeps each step's own view, through a GITHUB_ENV write and a later override", async () => {
    const s = session(COLOR_WORKFLOW);
    const lane = s.laneOrder[0];

    await controlStep(s, lane);
    await controlStep(s, lane); // writes COLOR=blue
    await controlStep(s, lane);

    expect(envAt(s, lane, 0).COLOR).toBe("red");
    expect(envAt(s, lane, 2).COLOR).toBe("blue");

    applyWhatIf(s, { env: { COLOR: "green" } });

    // The past does not move when the present changes.
    expect(envAt(s, lane, 0).COLOR).toBe("red");
    expect(envAt(s, lane, 2).COLOR).toBe("blue");
  });

  it("records what subsequent steps inherit", async () => {
    // `envAfter` is the whole environment a following step inherits, not the
    // bare `$GITHUB_ENV` additions - so before the write it still carries the
    // workflow-level `COLOR: red`, and after it the persisted `blue`.
    const s = session(COLOR_WORKFLOW);
    const lane = s.laneOrder[0];
    await controlStep(s, lane);
    expect(s.lanes[lane].steps[0].envAfter?.COLOR).toBe("red");
    await controlStep(s, lane); // writes COLOR=blue
    expect(s.lanes[lane].steps[1].envAfter?.COLOR).toBe("blue");
    // The bare additions remain available separately, on the lane itself.
    expect(s.lanes[lane].env).toEqual({ COLOR: "blue" });
  });

  it("separates what a finished step left from what the pending one would get", async () => {
    // Both questions used to land on the same index: the inspector asks
    // about the selected step, and selecting the last completed one put the
    // request on the pointer, where recomputing answered with the present.
    const s = session(COLOR_WORKFLOW);
    const lane = s.laneOrder[0];
    await controlStep(s, lane);
    await controlStep(s, lane); // writes COLOR=blue; pointer is now 2
    expect(s.lanes[lane].pointer).toBe(2);

    applyWhatIf(s, { env: { COLOR: "green" } });

    // Inspecting the last completed step: history, unmoved by the override.
    expect(envAfter(s, lane, 1).COLOR).toBe("blue");
    // Inspecting the pending step: what running it now would actually use.
    expect(envAt(s, lane, 2).COLOR).toBe("green");
  });

  it("actually replaces and deletes a secret, even after something was retired", async () => {
    // Retiring anything made the masking set a fresh object, and the patch
    // was being applied to *that* - so every later replace or delete
    // returned success and changed nothing. Masking staying correct is not
    // evidence the mutation worked; this asserts the mutation itself.
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ secrets.TOKEN }}"
`, { secrets: { TOKEN: "original-secret-alpha", OTHER: "other-secret-beta" } });

    applyWhatIf(s, { secrets: { OTHER: null } });
    expect(s.retiredSecretValues).toContain("other-secret-beta");

    applyWhatIf(s, { secrets: { TOKEN: "replacement-secret-gamma" } });
    expect(s.config.secrets.TOKEN).toBe("replacement-secret-gamma");

    applyWhatIf(s, { secrets: { TOKEN: null } });
    expect(s.config.secrets.TOKEN).toBeUndefined();

    // ...and the replacement is retired too, so it stays masked in anything
    // recorded while it was live.
    expect(s.retiredSecretValues).toContain("original-secret-alpha");
    expect(s.retiredSecretValues).toContain("replacement-secret-gamma");
  });

  it("takes a replaced secret into account when the next step runs", async () => {
    // The end-to-end consequence of the bug above: evaluation kept using the
    // old value, so a What-If secret edit had no effect on execution.
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
      - run: test "\${{ secrets.TOKEN }}" = "second-value-xyz" && echo MATCHED || echo STALE
`, { secrets: { TOKEN: "first-value-abc" } });
    const lane = s.laneOrder[0];
    await controlStep(s, lane);
    applyWhatIf(s, { secrets: { TOKEN: "second-value-xyz" } });
    const record = await controlStep(s, lane);
    expect(record.stdout).toContain("MATCHED");
  });

  it("keeps redacting a secret that What-If has since removed", async () => {
    const secret = "secret-value-alpha-0123456789";
    const s = session(
      `name: t
on: [push]
env:
  TOKEN: \${{ secrets.TOKEN }}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo one
      - run: echo two
`,
      { secrets: { TOKEN: secret } }
    );
    const lane = s.laneOrder[0];
    await controlStep(s, lane);
    expect(s.lanes[lane].steps[0].envBefore?.TOKEN).toBe(secret);

    // Deleting the secret must not un-redact the snapshots taken while it
    // was one: masking against only the current map would hand back the raw
    // value, since the map no longer contains it.
    applyWhatIf(s, { secrets: { TOKEN: null } });
    const secrets = secretsToMask(s.config.secrets, s.retiredSecretValues);
    expect(maskObjectStrings(s.lanes[lane].steps[0].envBefore ?? {}, secrets).TOKEN).toBe("***");

    // Replacing it with a different value is the same story.
    applyWhatIf(s, { secrets: { TOKEN: "another-secret-value-9876543210" } });
    const after = secretsToMask(s.config.secrets, s.retiredSecretValues);
    expect(maskObjectStrings(s.lanes[lane].steps[0].envBefore ?? {}, after).TOKEN).toBe("***");
  });

  it("shows a pending step's own env: before it runs", async () => {
    // The inspector's whole job here is "what will this step be given?", and
    // the step's `env:` is the last layer applied. Resolving without it meant
    // the answer only became correct after the step had already run.
    const s = session(`name: t
on: [push]
env:
  COLOR: workflow-red

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: overrides for itself
        env:
          COLOR: step-blue
        run: echo "$COLOR"
`);
    const lane = s.laneOrder[0];
    expect(s.lanes[lane].pointer).toBe(0);
    expect(envAt(s, lane, 0).COLOR).toBe("step-blue");

    // ...and it agrees with what the step actually prints.
    const record = await controlStep(s, lane);
    expect(record.stdout.trim()).toBe("step-blue");
    expect(envAt(s, lane, 0).COLOR).toBe("step-blue");
  });

  it("interpolates a pending step's env: rather than showing the template", async () => {
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - env:
          WHO: \${{ github.actor }}
        run: echo "$WHO"
`);
    expect(envAt(s, s.laneOrder[0], 0).WHO).toBe("local-debugger");
  });

  it("still applies pending What-If overrides under the step's own env:", async () => {
    // Step `env:` is the last layer, so it wins over an override - the live
    // view has to show that precedence, not just include both.
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - env:
          COLOR: step-blue
        run: echo "$COLOR"
`);
    const lane = s.laneOrder[0];
    applyWhatIf(s, { env: { COLOR: "whatif-green", OTHER: "whatif-only" } });
    expect(envAt(s, lane, 0).COLOR).toBe("step-blue");
    expect(envAt(s, lane, 0).OTHER).toBe("whatif-only");
  });

  it("includes the step's own env: layer in what it was given", async () => {
    const s = session(`name: t
on: [push]
env:
  COLOR: red

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: overrides for itself
        env:
          COLOR: purple
        run: echo "$COLOR"
`);
    const lane = s.laneOrder[0];
    await controlStep(s, lane);
    expect(s.lanes[lane].steps[0].envBefore?.COLOR).toBe("purple");
  });

  it("uses current overrides for the step that has not run yet", async () => {
    const s = session(COLOR_WORKFLOW);
    const lane = s.laneOrder[0];
    await controlStep(s, lane);
    applyWhatIf(s, { env: { COLOR: "green" } });
    // The pointer's step is still a live question, so it answers with what
    // running it now would actually use.
    expect(envAt(s, lane, s.lanes[lane].pointer).COLOR).toBe("green");
  });

  it("keeps matrix lanes' histories independent", async () => {
    const s = session(`name: t
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shade: [light, dark]
    steps:
      - name: writes its own shade
        run: echo "PICKED=\${{ matrix.shade }}" >> "$GITHUB_ENV"
      - name: reads it back
        run: echo "$PICKED"
`);
    const [first, second] = s.laneOrder;
    await controlStep(s, first);
    await controlStep(s, first);
    await controlStep(s, second);
    await controlStep(s, second);

    expect(s.lanes[first].steps[1].envBefore?.PICKED).toBe("light");
    expect(s.lanes[second].steps[1].envBefore?.PICKED).toBe("dark");
    expect(s.lanes[first].steps[0].envAfter).toEqual({ PICKED: "light" });
    expect(s.lanes[second].steps[0].envAfter).toEqual({ PICKED: "dark" });
  });

  it("keeps the snapshots out of the serialized session", async () => {
    const SECRET = "review-secret-value";
    const s = session(
      `name: t
on: [push]
env:
  TOKEN: \${{ secrets.TOKEN }}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`,
      { secrets: { TOKEN: SECRET } }
    );
    await controlStep(s, s.laneOrder[0]);
    expect(s.lanes[s.laneOrder[0]].steps[0].envBefore?.TOKEN).toBe(SECRET);

    const view = toSessionView(s);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(view.lanes[s.laneOrder[0]].steps[0].envBefore).toBeUndefined();
  });
});
