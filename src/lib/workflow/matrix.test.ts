import { describe, expect, it } from "vitest";
import {
  MAX_MATRIX_COMBINATIONS,
  comboKey,
  comboLabel,
  countCombinations,
  expandMatrix,
} from "./matrix";
import type { MatrixDefinition } from "./types";

describe("combination limits", () => {
  const axesOf = (count: number, size: number): Record<string, number[]> =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`axis${i}`, Array.from({ length: size }, (_, j) => j)])
    );

  it("counts a small matrix exactly", () => {
    expect(countCombinations({ axes: { os: ["a", "b"], node: [18, 20, 22] } })).toBe(6);
  });

  it("counts include entries as potential extra rows", () => {
    expect(
      countCombinations({ axes: { os: ["a", "b"] }, include: [{ os: "c" }, { os: "d" }] })
    ).toBe(4);
  });

  it("counts a matrix-less definition as zero combinations", () => {
    expect(countCombinations({ axes: {} })).toBe(0);
  });

  it("does not build the product to discover it is too large", () => {
    // 10 axes of 10 values is 10 billion combinations - expanding it to find
    // out would be the exact denial of service this guards against.
    const started = Date.now();
    expect(countCombinations({ axes: axesOf(10, 10) })).toBeGreaterThan(MAX_MATRIX_COMBINATIONS);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("refuses to expand a matrix over the limit", () => {
    expect(() => expandMatrix({ axes: axesOf(10, 10) })).toThrow(/more than 256 combinations/);
  });

  it("still expands a matrix exactly at the limit", () => {
    const combos = expandMatrix({ axes: axesOf(8, 2) }); // 2^8 = 256
    expect(combos).toHaveLength(MAX_MATRIX_COMBINATIONS);
  });
});

describe("expandMatrix", () => {
  it("computes a plain cross product", () => {
    const def: MatrixDefinition = {
      axes: { os: ["ubuntu-latest", "windows-latest"], node: [16, 18] },
    };
    const combos = expandMatrix(def);
    expect(combos).toHaveLength(4);
    expect(combos).toContainEqual({ os: "ubuntu-latest", node: 16 });
    expect(combos).toContainEqual({ os: "ubuntu-latest", node: 18 });
    expect(combos).toContainEqual({ os: "windows-latest", node: 16 });
    expect(combos).toContainEqual({ os: "windows-latest", node: 18 });
  });

  it("removes excluded combinations", () => {
    const def: MatrixDefinition = {
      axes: { os: ["ubuntu-latest", "windows-latest"], node: [16, 18] },
      exclude: [{ os: "windows-latest", node: 16 }],
    };
    const combos = expandMatrix(def);
    expect(combos).toHaveLength(3);
    expect(combos).not.toContainEqual({ os: "windows-latest", node: 16 });
  });

  it("matches GitHub's documented fruit/animal include example", () => {
    // From GitHub Actions docs: "Expanding configurations" example.
    const def: MatrixDefinition = {
      axes: { fruit: ["apple", "pear"], animal: ["cat", "dog"] },
      include: [
        { color: "green" },
        { color: "pink", animal: "cat" },
        { fruit: "apple", shape: "circle" },
        { fruit: "banana" },
        { fruit: "banana", animal: "cat" },
      ],
    };
    const combos = expandMatrix(def);
    expect(combos).toEqual([
      { fruit: "apple", animal: "cat", color: "pink", shape: "circle" },
      { fruit: "apple", animal: "dog", color: "green", shape: "circle" },
      { fruit: "pear", animal: "cat", color: "pink" },
      { fruit: "pear", animal: "dog", color: "green" },
      { fruit: "banana" },
      { fruit: "banana", animal: "cat" },
    ]);
  });

  it("supports include-only matrices with no base axes", () => {
    const def: MatrixDefinition = {
      axes: {},
      include: [{ os: "ubuntu-latest" }, { os: "macos-latest" }],
    };
    const combos = expandMatrix(def);
    expect(combos).toEqual([{ os: "ubuntu-latest" }, { os: "macos-latest" }]);
  });

  it("returns an empty list for an undefined matrix", () => {
    expect(expandMatrix(undefined)).toEqual([]);
  });
});

describe("comboLabel / comboKey", () => {
  it("labels the default (matrix-less) combo", () => {
    expect(comboLabel({})).toBe("default");
    expect(comboKey({})).toBe("default");
  });

  it("produces stable, sorted keys regardless of insertion order", () => {
    const a = { node: 18, os: "ubuntu-latest" };
    const b = { os: "ubuntu-latest", node: 18 };
    expect(comboKey(a)).toBe(comboKey(b));
    expect(comboLabel({ os: "ubuntu-latest", node: 18 })).toBe(
      "os=ubuntu-latest, node=18"
    );
  });
});
