import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSimulatedAction } from "./simulatedActions";

describe("runSimulatedAction", () => {
  let cwd: string;
  let artifactsDir: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sim-actions-"));
    artifactsDir = path.join(cwd, ".debugger", "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("handles actions/checkout with ref", () => {
    const result = runSimulatedAction(
      "actions/checkout@v4",
      { ref: "main", "fetch-depth": "0" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs.ref).toBe("main");
    expect(result.note).toContain("empty scratch workspace");
    expect(result.note).toContain("no files are checked out");
  });

  it("handles actions/setup-node and reports version + cache-hit", () => {
    const result = runSimulatedAction(
      "actions/setup-node@v4",
      { "node-version": "20" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs["node-version"]).toBe("20");
    expect(result.outputs["cache-hit"]).toBe("false");
    expect(result.note).toContain("setup-node");
  });

  it("handles actions/setup-python", () => {
    const result = runSimulatedAction(
      "actions/setup-python@v5",
      { "python-version": "3.12" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs["python-version"]).toBe("3.12");
    expect(result.outputs["python-path"]).toBe("python3");
  });

  it("handles actions/cache as a miss", () => {
    const result = runSimulatedAction(
      "actions/cache@v4",
      { key: "my-cache-key", path: "node_modules" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs["cache-hit"]).toBe("false");
    expect(result.note).toContain("my-cache-key");
  });

  it("resolves actions/cache/restore specifically", () => {
    const result = runSimulatedAction(
      "actions/cache/restore@v4",
      { key: "restore-key" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs["cache-hit"]).toBe("false");
    expect(result.outputs["cache-primary-key"]).toBe("restore-key");
  });

  it("uploads artifacts and preserves relative paths", () => {
    fs.writeFileSync(path.join(cwd, "report.txt"), "hello");
    fs.mkdirSync(path.join(cwd, "dist"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "dist", "out.js"), "console.log(1)");

    const result = runSimulatedAction(
      "actions/upload-artifact@v4",
      { name: "build", path: "dist/**" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs["artifact-id"]).toBe("build");
    expect(fs.existsSync(path.join(artifactsDir, "build", "dist", "out.js"))).toBe(true);
    expect(result.note).toMatch(/copied \d+ file/);
  });

  it("uploads on a fresh session, before the artifact store exists", () => {
    // The store is created lazily by the engine, so the first upload of a
    // session resolves against a directory that isn't there yet. The fixture
    // above pre-creates it, which hid this.
    const freshStore = path.join(cwd, "never-created", "artifacts");
    fs.mkdirSync(path.join(cwd, "dist"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "dist", "out.js"), "built");

    const result = runSimulatedAction(
      "actions/upload-artifact@v4",
      { name: "build", path: "dist/**" },
      cwd,
      freshStore
    );
    expect(result.conclusion).toBe("success");
    expect(result.note).toMatch(/copied 1 file/);
    expect(fs.existsSync(path.join(freshStore, "build", "dist", "out.js"))).toBe(true);
  });

  it("downloads on a fresh session without inventing a confinement failure", () => {
    const freshStore = path.join(cwd, "never-created-2", "artifacts");
    const result = runSimulatedAction(
      "actions/download-artifact@v4",
      { name: "missing", path: "restored" },
      cwd,
      freshStore
    );
    // Nothing to restore, but the reason must be the missing artifact - not a
    // claim that the name escaped the store.
    expect(result.conclusion).toBe("failure");
    expect(result.note).not.toMatch(/outside/);
  });

  it("downloads a named artifact", () => {
    const artDir = path.join(artifactsDir, "build");
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(path.join(artDir, "out.js"), "bundled");

    const result = runSimulatedAction(
      "actions/download-artifact@v4",
      { name: "build", path: "restored" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(fs.readFileSync(path.join(cwd, "restored", "out.js"), "utf8")).toBe("bundled");
  });

  it("fails download when named artifact is missing", () => {
    const result = runSimulatedAction(
      "actions/download-artifact@v4",
      { name: "does-not-exist" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("failure");
  });

  describe("path confinement", () => {
    let outside: string;

    beforeEach(() => {
      outside = fs.mkdtempSync(path.join(os.tmpdir(), "sim-outside-"));
      fs.writeFileSync(path.join(outside, "secret.txt"), "do-not-copy");
    });

    afterEach(() => {
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it("rejects an upload pattern that escapes the workspace", () => {
      const result = runSimulatedAction(
        "actions/upload-artifact@v4",
        { name: "leak", path: "../../**/secret.txt" },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("failure");
      expect(result.note).toContain("outside the job's workspace");
      expect(fs.existsSync(path.join(artifactsDir, "leak"))).toBe(false);
    });

    it("rejects an absolute upload pattern", () => {
      const result = runSimulatedAction(
        "actions/upload-artifact@v4",
        { name: "leak", path: `${outside}/secret.txt` },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("failure");
      expect(result.note).toContain("outside the job's workspace");
    });

    it("rejects an artifact name that escapes the artifact store", () => {
      const result = runSimulatedAction(
        "actions/upload-artifact@v4",
        { name: "../../escaped", path: "**" },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("failure");
      expect(result.note).toContain("outside the debugger's artifact store");
      expect(fs.existsSync(path.join(artifactsDir, "..", "..", "escaped"))).toBe(false);
    });

    it("rejects a download path that escapes the workspace", () => {
      const artDir = path.join(artifactsDir, "build");
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(path.join(artDir, "payload.txt"), "overwritten");

      const result = runSimulatedAction(
        "actions/download-artifact@v4",
        { name: "build", path: `../../${path.basename(outside)}` },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("failure");
      expect(result.note).toContain("outside the job's workspace");
      expect(fs.existsSync(path.join(outside, "payload.txt"))).toBe(false);
      expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("do-not-copy");
    });

    it("rejects a download artifact name that escapes the artifact store", () => {
      const result = runSimulatedAction(
        "actions/download-artifact@v4",
        { name: "../..", path: "restored" },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("failure");
      expect(result.note).toContain("outside the debugger's artifact store");
    });

    it("does not upload a file reached through a symlinked directory", () => {
      fs.symlinkSync(outside, path.join(cwd, "link"));
      const result = runSimulatedAction(
        "actions/upload-artifact@v4",
        { name: "build", path: "link/**" },
        cwd,
        artifactsDir
      );
      // The pattern is textually inside the workspace, so it is not refused
      // outright - each match is confined instead, and none survive.
      expect(result.conclusion).toBe("success");
      expect(result.note).toMatch(/copied 0 file/);
      expect(fs.existsSync(path.join(artifactsDir, "build", "link", "secret.txt"))).toBe(false);
    });

    it("does not restore from an artifact whose root is a symlink to outside", () => {
      fs.symlinkSync(outside, path.join(artifactsDir, "evil"));
      const result = runSimulatedAction(
        "actions/download-artifact@v4",
        { name: "evil", path: "restored" },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("failure");
      expect(fs.existsSync(path.join(cwd, "restored", "secret.txt"))).toBe(false);
    });

    it("does not write through a destination that is a symlink to outside", () => {
      fs.symlinkSync(outside, path.join(cwd, "dest"));
      const artDir = path.join(artifactsDir, "build");
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(path.join(artDir, "payload.txt"), "should not land outside");

      const result = runSimulatedAction(
        "actions/download-artifact@v4",
        { name: "build", path: "dest" },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("failure");
      expect(fs.existsSync(path.join(outside, "payload.txt"))).toBe(false);
    });

    it("rejects a path containing a NUL byte instead of throwing", () => {
      // `path: "a\0b"` is reachable straight from pasted YAML, and reaches
      // fs before any handler validates it.
      const result = runSimulatedAction(
        "actions/download-artifact@v4",
        { name: "build", path: "a\u0000b" },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("failure");
    });

    it("stops copying at the artifact byte cap", () => {
      fs.mkdirSync(path.join(cwd, "big"), { recursive: true });
      // Two files either side of the 100MB cap, sparse so the test stays fast.
      for (const name of ["a.bin", "b.bin"]) {
        const fd = fs.openSync(path.join(cwd, "big", name), "w");
        fs.ftruncateSync(fd, 60 * 1024 * 1024);
        fs.closeSync(fd);
      }
      const result = runSimulatedAction(
        "actions/upload-artifact@v4",
        { name: "big", path: "big/**" },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("success");
      expect(result.note).toMatch(/size\/count cap/);
      expect(result.note).toMatch(/copied 1 file/);
    });

    it("still allows ordinary relative paths inside the workspace", () => {
      fs.mkdirSync(path.join(cwd, "dist"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "dist", "app.js"), "ok");

      const result = runSimulatedAction(
        "actions/upload-artifact@v4",
        { name: "build", path: "./dist/**" },
        cwd,
        artifactsDir
      );
      expect(result.conclusion).toBe("success");
      expect(fs.existsSync(path.join(artifactsDir, "build", "dist", "app.js"))).toBe(true);
    });
  });

  it("handles docker/login-action", () => {
    const result = runSimulatedAction(
      "docker/login-action@v3",
      { registry: "ghcr.io", username: "user", password: "secret" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.note).toContain("ghcr.io");
    expect(result.note).toContain("user");
  });

  it("handles docker/build-push-action", () => {
    const result = runSimulatedAction(
      "docker/build-push-action@v5",
      { tags: "myimg:latest", push: true },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs.digest).toMatch(/^sha256:/);
    expect(result.note).toContain("push");
  });

  it("handles docker/metadata-action", () => {
    const result = runSimulatedAction(
      "docker/metadata-action@v5",
      { images: "ghcr.io/org/app" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs.tags).toContain("ghcr.io/org/app");
  });

  it("falls back gracefully for unknown third-party actions", () => {
    const result = runSimulatedAction(
      "some-org/some-action@v1",
      { foo: "bar" },
      cwd,
      artifactsDir
    );
    expect(result.conclusion).toBe("success");
    expect(result.outputs).toEqual({});
    expect(result.note).toContain("third-party or composite");
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "treats uses: %s@v1 as an unknown action, not as a handler it inherited",
    (name) => {
      // `HANDLERS` is a plain object, so looking one of these up returned
      // an inherited function (or object) as if it were a handler: the step
      // then "succeeded" with no outcome and no outputs, or threw.
      const result = runSimulatedAction(`${name}@v1`, {}, cwd, artifactsDir);
      expect(result.conclusion).toBe("success");
      expect(result.outputs).toEqual({});
      expect(result.note).toContain("third-party or composite");
    }
  );
});
