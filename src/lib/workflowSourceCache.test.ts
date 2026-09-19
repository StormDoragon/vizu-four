import { describe, expect, it } from "vitest";
import { loadWorkflowSource, saveWorkflowSource, type SourceCacheStorage } from "./workflowSourceCache";

function fakeStorage(): SourceCacheStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("workflowSourceCache", () => {
  it("round-trips a saved source by its hash", () => {
    const storage = fakeStorage();
    saveWorkflowSource("hash-a", "name: A", storage);
    expect(loadWorkflowSource("hash-a", storage)).toBe("name: A");
  });

  it("returns null for a hash that was never saved", () => {
    const storage = fakeStorage();
    expect(loadWorkflowSource("nope", storage)).toBe(null);
  });

  it("returns null when storage is unavailable", () => {
    expect(loadWorkflowSource("hash-a", null)).toBe(null);
    expect(() => saveWorkflowSource("hash-a", "x", null)).not.toThrow();
  });

  it("overwrites the entry for the same hash instead of duplicating it", () => {
    const storage = fakeStorage();
    saveWorkflowSource("hash-a", "first", storage);
    saveWorkflowSource("hash-a", "second", storage);
    expect(loadWorkflowSource("hash-a", storage)).toBe("second");
    expect(JSON.parse(storage.map.get("vizu-four:workflow-sources")!)).toHaveLength(1);
  });

  it("evicts the oldest entry once the cap is exceeded", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 25; i++) saveWorkflowSource(`hash-${i}`, `yaml-${i}`, storage);
    expect(loadWorkflowSource("hash-0", storage)).toBe(null);
    expect(loadWorkflowSource("hash-24", storage)).toBe("yaml-24");
    expect(JSON.parse(storage.map.get("vizu-four:workflow-sources")!)).toHaveLength(20);
  });

  it("does not throw and treats corrupted stored JSON as empty", () => {
    const storage = fakeStorage();
    storage.map.set("vizu-four:workflow-sources", "{not json");
    expect(loadWorkflowSource("hash-a", storage)).toBe(null);
    expect(() => saveWorkflowSource("hash-a", "x", storage)).not.toThrow();
  });
});
