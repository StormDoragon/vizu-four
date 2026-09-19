import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWorkflow } from "../workflow/parser";
import { createSession } from "./session";
import {
  deleteSessionAndWorkspace,
  getSession,
  reapStaleSessions,
  saveSession,
} from "./store";

const MINIMAL_YAML = `
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

async function makeSession(opts: { usesRealWorkspace?: boolean } = {}) {
  const { workflow } = parseWorkflow(MINIMAL_YAML);
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "store-test-"));
  const session = createSession({
    workflow: workflow!,
    workspaceDir,
    ownerId: "test-owner",
    usesRealWorkspace: opts.usesRealWorkspace,
  });
  saveSession(session);
  return session;
}

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("session store", () => {
  it("bumps lastAccessedAt on getSession", async () => {
    const session = await makeSession();
    createdDirs.push(session.workspaceDir);
    const before = session.lastAccessedAt;
    await new Promise((r) => setTimeout(r, 5));
    getSession(session.id);
    expect(session.lastAccessedAt).not.toBe(before);
  });

  it("deleteSessionAndWorkspace removes the session and its workspace dir", async () => {
    const session = await makeSession();
    await expect(fs.stat(session.workspaceDir)).resolves.toBeDefined();

    const removed = await deleteSessionAndWorkspace(session.id);
    expect(removed).toBe(true);
    expect(getSession(session.id)).toBeUndefined();
    await expect(fs.stat(session.workspaceDir)).rejects.toThrow();
  });

  it("never deletes a real working-tree directory the user opted into, only the session's own temp root", async () => {
    const realDir = await fs.mkdtemp(path.join(os.tmpdir(), "store-test-real-repo-"));
    createdDirs.push(realDir);
    await fs.writeFile(path.join(realDir, "keep-me.txt"), "do not delete");

    const { workflow } = parseWorkflow(MINIMAL_YAML);
    const session = createSession({
      workflow: workflow!,
      workspaceDir: realDir,
      ownerId: "test-owner",
      usesRealWorkspace: true,
    });
    saveSession(session);

    const removed = await deleteSessionAndWorkspace(session.id);
    expect(removed).toBe(true);
    expect(getSession(session.id)).toBeUndefined();
    // The real directory - and the file in it - must survive.
    await expect(fs.stat(path.join(realDir, "keep-me.txt"))).resolves.toBeDefined();
  });

  it("reapStaleSessions only deletes sessions idle past the TTL", async () => {
    const fresh = await makeSession();
    createdDirs.push(fresh.workspaceDir);
    const stale = await makeSession();
    stale.lastAccessedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    await reapStaleSessions();

    expect(getSession(fresh.id)).toBeDefined();
    expect(getSession(stale.id)).toBeUndefined();
    await expect(fs.stat(stale.workspaceDir)).rejects.toThrow();
  });
});
