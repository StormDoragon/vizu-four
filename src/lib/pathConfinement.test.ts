import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { escapesBase, resolveWithin } from "./pathConfinement";

describe("resolveWithin", () => {
  let base: string;
  let outside: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "confine-base-")));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "confine-out-")));
    fs.writeFileSync(path.join(outside, "canary.txt"), "outside");
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("resolves an ordinary relative path", () => {
    fs.writeFileSync(path.join(base, "a.txt"), "x");
    expect(resolveWithin(base, "a.txt")).toBe(path.join(base, "a.txt"));
  });

  it("resolves a path that does not exist yet", () => {
    expect(resolveWithin(base, "new/nested/file.txt")).toBe(
      path.join(base, "new", "nested", "file.txt")
    );
  });

  it("allows the base itself", () => {
    expect(resolveWithin(base, ".")).toBe(base);
  });

  it("rejects parent traversal", () => {
    expect(resolveWithin(base, "../escape.txt")).toBeNull();
    expect(resolveWithin(base, "a/../../escape.txt")).toBeNull();
  });

  it("rejects an absolute segment", () => {
    expect(resolveWithin(base, "/etc/passwd")).toBeNull();
  });

  it("rejects a file reached through a symlinked directory", () => {
    // The textual path stays inside the base; only resolving the link shows
    // that the real file is not.
    fs.symlinkSync(outside, path.join(base, "link"));
    expect(path.resolve(base, "link/canary.txt").startsWith(base)).toBe(true);
    expect(resolveWithin(base, "link/canary.txt")).toBeNull();
  });

  it("rejects a symlink that is itself the target", () => {
    fs.symlinkSync(path.join(outside, "canary.txt"), path.join(base, "alias.txt"));
    expect(resolveWithin(base, "alias.txt")).toBeNull();
  });

  it("rejects a not-yet-existing path under a symlinked directory", () => {
    fs.symlinkSync(outside, path.join(base, "dest"));
    expect(resolveWithin(base, "dest/new-file.txt")).toBeNull();
  });

  it("allows a symlink that stays inside the base", () => {
    fs.mkdirSync(path.join(base, "real"));
    fs.writeFileSync(path.join(base, "real", "ok.txt"), "x");
    fs.symlinkSync(path.join(base, "real"), path.join(base, "inner-link"));
    expect(resolveWithin(base, "inner-link/ok.txt")).toBe(path.join(base, "real", "ok.txt"));
  });

  it("returns null when the base itself does not exist", () => {
    expect(resolveWithin(path.join(base, "missing"), "x.txt")).toBeNull();
  });
});

describe("escapesBase", () => {
  it("flags absolute and parent-traversal patterns", () => {
    expect(escapesBase("/etc/**")).toBe(true);
    expect(escapesBase("../**")).toBe(true);
    expect(escapesBase("a/../../b")).toBe(true);
  });

  it("leaves ordinary patterns alone", () => {
    expect(escapesBase("dist/**")).toBe(false);
    expect(escapesBase("./dist/**")).toBe(false);
    expect(escapesBase("**/*.json")).toBe(false);
  });
});
