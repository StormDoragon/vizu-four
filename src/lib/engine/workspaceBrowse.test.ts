import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRealWorkspaceAllowed,
  listWorkflowFiles,
  resolveWorkingTree,
  WorkspaceError,
} from "./workspaceBrowse";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-browse-test-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("resolveWorkingTree", () => {
  it("resolves and returns an existing directory's absolute path", async () => {
    await expect(resolveWorkingTree(dir)).resolves.toBe(path.resolve(dir));
  });

  it("rejects a path that doesn't exist", async () => {
    await expect(resolveWorkingTree(path.join(dir, "nope"))).rejects.toThrow(WorkspaceError);
  });

  it("rejects a path that is a file, not a directory", async () => {
    const file = path.join(dir, "file.txt");
    await fs.writeFile(file, "hi");
    await expect(resolveWorkingTree(file)).rejects.toThrow(WorkspaceError);
  });

  it("rejects an empty string", async () => {
    await expect(resolveWorkingTree("")).rejects.toThrow(WorkspaceError);
  });

  it("resolves a relative path against the server's own cwd", async () => {
    const rel = path.relative(process.cwd(), dir);
    await expect(resolveWorkingTree(rel)).resolves.toBe(path.resolve(dir));
  });
});

describe("listWorkflowFiles", () => {
  it("returns an empty list when .github/workflows doesn't exist", async () => {
    await expect(listWorkflowFiles(dir)).resolves.toEqual([]);
  });

  it("lists .yml and .yaml files under .github/workflows, sorted, with content", async () => {
    const workflowsDir = path.join(dir, ".github", "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    await fs.writeFile(path.join(workflowsDir, "b.yml"), "name: B\n");
    await fs.writeFile(path.join(workflowsDir, "a.yaml"), "name: A\n");
    await fs.writeFile(path.join(workflowsDir, "readme.md"), "not a workflow");

    const files = await listWorkflowFiles(dir);
    expect(files.map((f) => f.name)).toEqual(["a.yaml", "b.yml"]);
    expect(files[0].content).toBe("name: A\n");
    expect(files[0].relativePath).toBe(path.join(".github", "workflows", "a.yaml"));
  });

  it("skips a non-regular or outsized entry rather than failing the whole listing", async () => {
    const workflowsDir = path.join(dir, ".github", "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    await fs.mkdir(path.join(workflowsDir, "not-a-file.yml"));
    await fs.writeFile(path.join(workflowsDir, "real.yml"), "name: Real\n");

    const files = await listWorkflowFiles(dir);
    expect(files.map((f) => f.name)).toEqual(["real.yml"]);
  });

  it("rejects a directory that doesn't exist", async () => {
    await expect(listWorkflowFiles(path.join(dir, "nope"))).rejects.toThrow(WorkspaceError);
  });
});

describe("assertRealWorkspaceAllowed", () => {
  const original = process.env.VIZU_DEMO_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.VIZU_DEMO_MODE;
    else process.env.VIZU_DEMO_MODE = original;
  });

  it("allows real-workspace access when this deployment isn't simulation-only", () => {
    delete process.env.VIZU_DEMO_MODE;
    expect(() => assertRealWorkspaceAllowed()).not.toThrow();
  });

  it("blocks real-workspace access in simulation-only mode, with a 403", () => {
    process.env.VIZU_DEMO_MODE = "1";
    try {
      assertRealWorkspaceAllowed();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceError);
      expect((err as WorkspaceError).status).toBe(403);
    }
  });
});
