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
});
