import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWorkflow } from "../workflow/parser";
import { createSession } from "./session";
import {
  deleteSessionAndWorkspace,
  getSession,
  listSessions,
  reapStaleSessions,
  releaseSessionSlot,
  reserveSessionSlot,
  resetSessionSlots,
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

describe("admission reservations", () => {
  // Earlier tests in this file leave sessions in the shared store, and those
  // count toward the caps being asserted here.
  beforeEach(async () => {
    resetSessionSlots();
    for (const s of listSessions()) await deleteSessionAndWorkspace(s.id);
  });
  afterEach(() => resetSessionSlots());

  it("admits only up to the total cap when nothing has been saved yet", () => {
    // Every caller here reserves before any of them saves - the shape of
    // concurrent requests all passing the same check before one lands.
    let admitted = 0;
    for (let i = 0; i < 10; i++) {
      if (reserveSessionSlot(`owner-${i}`, 100, 4) === null) admitted++;
    }
    expect(admitted).toBe(4);
  });

  it("admits only up to the per-owner cap for one owner", () => {
    let admitted = 0;
    for (let i = 0; i < 10; i++) {
      if (reserveSessionSlot("same-owner", 3, 100) === null) admitted++;
    }
    expect(admitted).toBe(3);
  });

  it("names which cap refused", () => {
    expect(reserveSessionSlot("o", 1, 100)).toBeNull();
    expect(reserveSessionSlot("o", 1, 100)).toBe("owner");
    expect(reserveSessionSlot("other", 100, 1)).toBe("total");
  });

  it("frees the slot again on release, so a failed attempt costs nothing", () => {
    expect(reserveSessionSlot("o", 1, 100)).toBeNull();
    expect(reserveSessionSlot("o", 1, 100)).toBe("owner");
    releaseSessionSlot("o");
    expect(reserveSessionSlot("o", 1, 100)).toBeNull();
  });

  it("holds the line when reservations interleave with awaits", async () => {
    const cap = 3;
    const saved: string[] = [];
    const attempt = async (id: string) => {
      if (reserveSessionSlot("owner", 100, cap) !== null) return;
      try {
        await Promise.resolve(); // stands in for mkdtemp
        saved.push(id);
      } finally {
        releaseSessionSlot("owner");
      }
    };
    await Promise.all(Array.from({ length: 12 }, (_, i) => attempt(`s${i}`)));
    expect(saved).toHaveLength(cap);
  });
});
