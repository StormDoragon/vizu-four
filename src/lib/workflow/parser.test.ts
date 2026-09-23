import { describe, expect, it } from "vitest";
import { parseWorkflow } from "./parser";

describe("parseWorkflow", () => {
  it("parses a simple workflow", () => {
    const src = `
name: CI
on: push
env:
  NODE_ENV: test
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: npm ci
      - name: Test
        id: run_tests
        run: npm test
`;
    const { workflow, issues } = parseWorkflow(src);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(workflow).not.toBeNull();
    expect(workflow!.name).toBe("CI");
    expect(workflow!.on).toBe("push");
    expect(Object.keys(workflow!.jobs)).toEqual(["build"]);
    expect(workflow!.jobs.build.steps).toHaveLength(3);
    expect(workflow!.jobs.build.steps[2].key).toBe("run_tests");
    expect(workflow!.jobs.build.steps[1].key).toBe("step-1");
  });

  it("does not choke on the on/true YAML gotcha", () => {
    const src = `
"on": push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;
    const { workflow } = parseWorkflow(src);
    expect(workflow?.on).toBe("push");
  });

  it("normalizes needs to an array", () => {
    const src = `
jobs:
  a:
    runs-on: ubuntu-latest
    steps: [{ run: echo a }]
  b:
    needs: a
    runs-on: ubuntu-latest
    steps: [{ run: echo b }]
`;
    const { workflow } = parseWorkflow(src);
    expect(workflow!.jobs.b.needs).toEqual(["a"]);
  });

  it("reports an error for unknown needs", () => {
    const src = `
jobs:
  b:
    needs: ghost
    runs-on: ubuntu-latest
    steps: [{ run: echo b }]
`;
    const { issues } = parseWorkflow(src);
    expect(
      issues.some((i) => i.severity === "error" && i.message.includes("ghost"))
    ).toBe(true);
  });

  it("returns null workflow and an error on invalid YAML", () => {
    const { workflow, issues } = parseWorkflow("jobs: [this is not: valid: yaml");
    expect(workflow).toBeNull();
    expect(issues[0].severity).toBe("error");
  });

  it("parses matrix strategy axes, include and exclude", () => {
    const src = `
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [16, 18]
        exclude:
          - os: windows-latest
            node: 16
    steps: [{ run: echo hi }]
`;
    const { workflow } = parseWorkflow(src);
    const matrix = workflow!.jobs.build.strategy!.matrix!;
    expect(matrix.axes.os).toEqual(["ubuntu-latest", "windows-latest"]);
    expect(matrix.axes.node).toEqual([16, 18]);
    expect(matrix.exclude).toEqual([{ os: "windows-latest", node: 16 }]);
  });

  it("coerces a YAML boolean/number if: into a string expression instead of dropping it", () => {
    const src = `
jobs:
  build:
    runs-on: ubuntu-latest
    if: false
    steps:
      - run: echo hi
        if: 0
`;
    const { workflow } = parseWorkflow(src);
    expect(workflow!.jobs.build.if).toBe("false");
    expect(workflow!.jobs.build.steps[0].if).toBe("0");
  });

  it("warns when a job's steps list is empty", () => {
    const src = `
jobs:
  empty:
    runs-on: ubuntu-latest
    steps: []
`;
    const { workflow, issues } = parseWorkflow(src);
    expect(workflow!.jobs.empty.steps).toEqual([]);
    expect(
      issues.some((i) => i.severity === "warning" && i.message.includes("jobs.empty.steps is empty"))
    ).toBe(true);
  });

  it("rejects a YAML alias bomb instead of expanding it", () => {
    const src = `
a: &a [1,1,1,1,1,1,1,1,1,1]
b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]
d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]
e: [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;
    const { workflow, issues } = parseWorkflow(src);
    expect(workflow).toBeNull();
    expect(
      issues.some((i) => i.severity === "error" && /alias amplification|YAML bomb/i.test(i.message))
    ).toBe(true);
  });

  it("still parses a normal workflow that happens to use anchors", () => {
    const src = `
jobs:
  build:
    runs-on: ubuntu-latest
    env: &common_env
      NODE_ENV: test
    steps:
      - run: echo hi
        env: *common_env
`;
    const { workflow, issues } = parseWorkflow(src);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(workflow).not.toBeNull();
    expect(workflow!.jobs.build.steps[0].env).toEqual({ NODE_ENV: "test" });
  });
});

describe("parseWorkflow with names every object inherits", () => {
  it.each(["constructor", "__proto__", "toString"])(
    "reports needs: %s as an unknown job, not as one it found by inheritance",
    (dep) => {
      // `jobs` is a plain object, so `jobs[dep]` finds an inherited value
      // for these - truthy, so the reference passed as valid and the typo
      // (or worse) went unreported.
      const { issues } = parseWorkflow(`
jobs:
  a:
    runs-on: ubuntu-latest
    needs: ${dep}
    steps: [{ run: echo a }]
`);
      expect(issues.some((i) => i.message.includes(`unknown job '${dep}'`))).toBe(true);
    }
  );
});

describe("parseWorkflow with a key named __proto__", () => {
  // Assigning `map["__proto__"]` replaces the map's prototype instead of
  // adding an entry, so these used to disappear without any issue at all.
  it("reports a job named __proto__ instead of silently dropping it", () => {
    const { workflow, issues } = parseWorkflow(`
jobs:
  __proto__:
    runs-on: ubuntu-latest
    steps: [{ run: echo lost }]
  real:
    runs-on: ubuntu-latest
    steps: [{ run: echo hi }]
`);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("jobs.__proto__"))).toBe(
      true
    );
    expect(Object.keys(workflow!.jobs)).toEqual(["real"]);
    // The map keeps its ordinary prototype rather than inheriting a job.
    expect(Object.getPrototypeOf(workflow!.jobs)).toBe(Object.prototype);
  });

  it("reports a matrix axis named __proto__ instead of silently dropping it", () => {
    const { workflow, issues } = parseWorkflow(`
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        __proto__: [1, 2]
        node: [18, 20]
    steps: [{ run: echo hi }]
`);
    expect(issues.some((i) => i.message.includes("matrix.__proto__"))).toBe(true);
    expect(Object.keys(workflow!.jobs.build.strategy!.matrix!.axes)).toEqual(["node"]);
  });
});
