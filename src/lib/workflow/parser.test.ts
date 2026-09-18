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
});
