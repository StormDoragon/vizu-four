import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callBuiltin, ExpressionFunctionError } from "./functions";

describe("hashFiles confinement", () => {
  let cwd: string;
  let outside: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hashfiles-cwd-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "hashfiles-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "server-side-content");
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("hashes files inside the workspace", () => {
    fs.writeFileSync(path.join(cwd, "package-lock.json"), "{}");
    const hash = callBuiltin("hashFiles", ["**/*.json"], cwd);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns an empty string when nothing matches", () => {
    expect(callBuiltin("hashFiles", ["**/*.nope"], cwd)).toBe("");
  });

  it("rejects an absolute pattern rather than reading outside the workspace", () => {
    expect(() => callBuiltin("hashFiles", [`${outside}/secret.txt`], cwd)).toThrow(
      ExpressionFunctionError
    );
    expect(() => callBuiltin("hashFiles", [`${outside}/secret.txt`], cwd)).toThrow(
      /outside the workspace/
    );
  });

  it("rejects a parent-directory traversal pattern", () => {
    expect(() => callBuiltin("hashFiles", ["../**/secret.txt"], cwd)).toThrow(
      /outside the workspace/
    );
  });

  it("rejects an escaping pattern even when mixed with a valid one", () => {
    fs.writeFileSync(path.join(cwd, "ok.txt"), "fine");
    expect(() => callBuiltin("hashFiles", ["ok.txt", "../**"], cwd)).toThrow(
      /outside the workspace/
    );
  });

  it("reports rather than silently truncating when too many files match", () => {
    for (let i = 0; i < 1001; i++) {
      fs.writeFileSync(path.join(cwd, `f${i}.txt`), String(i));
    }
    expect(() => callBuiltin("hashFiles", ["**/*.txt"], cwd)).toThrow(/over the 1000-file limit/);
  });

  it("is stable for the same contents and changes when they do", () => {
    fs.writeFileSync(path.join(cwd, "a.txt"), "one");
    const first = callBuiltin("hashFiles", ["**/*.txt"], cwd);
    expect(callBuiltin("hashFiles", ["**/*.txt"], cwd)).toBe(first);

    fs.writeFileSync(path.join(cwd, "a.txt"), "two");
    expect(callBuiltin("hashFiles", ["**/*.txt"], cwd)).not.toBe(first);
  });
});
