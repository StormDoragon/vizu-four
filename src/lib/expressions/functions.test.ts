import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callBuiltin, ExpressionFunctionError, MAX_EXPRESSION_VALUE_CHARS } from "./functions";
import { evaluateExpression } from "./evaluator";
import { sampleEvalContext } from "./sampleContext";

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

  it("refuses entirely when there is no session workspace", () => {
    // The playground evaluates without a session; it used to fall back to
    // process.cwd(), making hashFiles an oracle over the server's own files.
    expect(() => callBuiltin("hashFiles", ["**"], null)).toThrow(ExpressionFunctionError);
    expect(() => callBuiltin("hashFiles", ["**"], null)).toThrow(/needs a debug session/);
  });

  it("does not hash a file reached through a symlinked directory", () => {
    fs.symlinkSync(outside, path.join(cwd, "link"));
    expect(callBuiltin("hashFiles", ["link/canary.txt"], cwd)).toBe("");
    expect(callBuiltin("hashFiles", ["link/**"], cwd)).toBe("");
  });

  it("does not hash a symlink that points outside", () => {
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(cwd, "alias.txt"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside-content");
    expect(callBuiltin("hashFiles", ["alias.txt"], cwd)).toBe("");
  });

  it("still hashes a symlink that stays inside the workspace", () => {
    fs.mkdirSync(path.join(cwd, "real"));
    fs.writeFileSync(path.join(cwd, "real", "lock.json"), "{}");
    fs.symlinkSync(path.join(cwd, "real"), path.join(cwd, "inner"));
    expect(callBuiltin("hashFiles", ["inner/lock.json"], cwd)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports rather than silently truncating when matches exceed the byte limit", () => {
    fs.mkdirSync(path.join(cwd, "big"));
    for (const name of ["a.bin", "b.bin"]) {
      const fd = fs.openSync(path.join(cwd, "big", name), "w");
      fs.ftruncateSync(fd, 30 * 1024 * 1024);
      fs.closeSync(fd);
    }
    expect(() => callBuiltin("hashFiles", ["big/**"], cwd)).toThrow(/exceed the 50MB limit/);
  });

  it("is stable for the same contents and changes when they do", () => {
    fs.writeFileSync(path.join(cwd, "a.txt"), "one");
    const first = callBuiltin("hashFiles", ["**/*.txt"], cwd);
    expect(callBuiltin("hashFiles", ["**/*.txt"], cwd)).toBe(first);

    fs.writeFileSync(path.join(cwd, "a.txt"), "two");
    expect(callBuiltin("hashFiles", ["**/*.txt"], cwd)).not.toBe(first);
  });
});

describe("value size budget", () => {
  const nest = (levels: number) => {
    let e = "'A'";
    for (let i = 0; i < levels; i++) e = `format('{0}{0}{0}{0}', ${e})`;
    return e;
  };

  it("refuses an expression that amplifies past the cap", () => {
    // A repeated placeholder quadruples its input while writing it once, so
    // nesting multiplies: 14 levels is 339 characters of source and used to
    // produce a 268MB string - a one-request way to exhaust the instance.
    expect(() => evaluateExpression(nest(14), sampleEvalContext())).toThrow(
      /more than 100000 characters/
    );
  });

  it("refuses at the innermost call, so nothing larger is allocated", () => {
    // The cap is only meaningful if it stops the allocation rather than
    // rejecting a string that has already been built.
    const started = Date.now();
    expect(() => evaluateExpression(nest(40), sampleEvalContext())).toThrow(
      /more than 100000 characters/
    );
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("still evaluates an expression comfortably under the cap", () => {
    expect((evaluateExpression(nest(8), sampleEvalContext()) as string).length).toBe(65536);
  });

  it("caps join() over a large array", () => {
    const big = "x".repeat(20_000);
    expect(() => callBuiltin("join", [[big, big, big, big, big, big], ","], null)).toThrow(
      /join\(\) would produce more than/
    );
  });

  it("caps toJSON() of an oversized value", () => {
    expect(() => callBuiltin("toJSON", ["x".repeat(MAX_EXPRESSION_VALUE_CHARS + 1)], null)).toThrow(
      /toJSON\(\) would produce more than/
    );
  });
});

describe("hashFiles algorithm", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hashfiles-alg-")));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /**
   * GitHub's algorithm, written out independently of the implementation:
   * SHA-256 over the concatenated raw per-file SHA-256 digests. The runner
   * writes `hash.digest()` - the bytes, not their hex text - into the outer
   * hash.
   */
  const reference = (names: string[]) => {
    const outer = createHash("sha256");
    for (const name of names) {
      outer.update(createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest());
    }
    return outer.digest("hex");
  };

  /** What this used to do: one hash over the contents end to end. */
  const concatenatedContents = (names: string[]) => {
    const h = createHash("sha256");
    for (const name of names) h.update(fs.readFileSync(path.join(dir, name)));
    return h.digest("hex");
  };

  it("hashes each file first, then hashes those hashes", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "alpha\n");
    const hash = callBuiltin("hashFiles", ["a.txt"], dir);
    expect(hash).toBe(reference(["a.txt"]));
    // The distinction is the whole finding: a cache key computed the old way
    // never matched the one the real workflow computed.
    expect(hash).not.toBe(concatenatedContents(["a.txt"]));
  });

  it("matches the reference across several files", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "alpha\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "beta\n");
    const hash = callBuiltin("hashFiles", ["*.txt"], dir);
    expect(hash).toBe(reference(["a.txt", "b.txt"]));
    expect(hash).not.toBe(concatenatedContents(["a.txt", "b.txt"]));
  });

  it("distinguishes a file split differently across the same total bytes", () => {
    // Hashing contents end to end gives these two sets the same digest,
    // which is the concrete way the old algorithm was wrong.
    fs.writeFileSync(path.join(dir, "a.txt"), "alpha");
    fs.writeFileSync(path.join(dir, "b.txt"), "beta");
    const split = callBuiltin("hashFiles", ["*.txt"], dir);

    fs.rmSync(path.join(dir, "a.txt"));
    fs.rmSync(path.join(dir, "b.txt"));
    fs.writeFileSync(path.join(dir, "c.txt"), "alphabeta");
    const joined = callBuiltin("hashFiles", ["*.txt"], dir);

    expect(split).not.toBe(joined);
  });

  it("returns an empty string when nothing matches, not the empty hash", () => {
    expect(callBuiltin("hashFiles", ["nothing-*.txt"], dir)).toBe("");
    expect(callBuiltin("hashFiles", ["nothing-*.txt"], dir)).not.toBe(
      createHash("sha256").digest("hex")
    );
  });

  it("is stable across calls and sensitive to content", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "alpha\n");
    const first = callBuiltin("hashFiles", ["a.txt"], dir);
    expect(callBuiltin("hashFiles", ["a.txt"], dir)).toBe(first);
    fs.writeFileSync(path.join(dir, "a.txt"), "alpha changed\n");
    expect(callBuiltin("hashFiles", ["a.txt"], dir)).not.toBe(first);
  });
});
