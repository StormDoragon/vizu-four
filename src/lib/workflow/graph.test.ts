import { describe, expect, it } from "vitest";
import { parseWorkflow } from "./parser";
import { buildJobGraph } from "./graph";

function graphFor(src: string) {
  const { workflow } = parseWorkflow(src);
  if (!workflow) throw new Error("expected workflow to parse");
  return buildJobGraph(workflow);
}

describe("buildJobGraph", () => {
  it("puts independent jobs in the same level", () => {
    const graph = graphFor(`
jobs:
  a: { runs-on: ubuntu-latest, steps: [{ run: echo a }] }
  b: { runs-on: ubuntu-latest, steps: [{ run: echo b }] }
`);
    expect(graph.levels).toEqual([["a", "b"]]);
  });

  it("orders a diamond dependency into three levels", () => {
    const graph = graphFor(`
jobs:
  a: { runs-on: ubuntu-latest, steps: [{ run: echo a }] }
  b: { needs: a, runs-on: ubuntu-latest, steps: [{ run: echo b }] }
  c: { needs: a, runs-on: ubuntu-latest, steps: [{ run: echo c }] }
  d: { needs: [b, c], runs-on: ubuntu-latest, steps: [{ run: echo d }] }
`);
    expect(graph.levels).toEqual([["a"], ["b", "c"], ["d"]]);
    expect(graph.levelOf.d).toBe(2);
    expect(graph.dependents.a.sort()).toEqual(["b", "c"]);
    expect(graph.cycles).toEqual([]);
  });

  it("detects cycles instead of hanging", () => {
    const graph = graphFor(`
jobs:
  a: { needs: b, runs-on: ubuntu-latest, steps: [{ run: echo a }] }
  b: { needs: a, runs-on: ubuntu-latest, steps: [{ run: echo b }] }
`);
    expect(graph.levels).toEqual([]);
    expect(graph.cycles).toEqual([["a", "b"]]);
  });
});
