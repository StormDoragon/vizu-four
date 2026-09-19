import { beforeEach, describe, expect, it } from "vitest";
import type { SessionView } from "./engine/serialize";
import {
  clearPrefs,
  isPristine,
  loadPrefs,
  parsePrefs,
  prefsFromSession,
  prefsKey,
  restorableBreakpoints,
  savePrefs,
  splitBreakpoint,
  type DebugPrefs,
  type PrefsStorage,
} from "./debugPrefs";

function fakeStorage(): PrefsStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function prefs(overrides: Partial<DebugPrefs> = {}): DebugPrefs {
  return {
    version: 1,
    breakpoints: [],
    envOverrides: {},
    vars: {},
    secretNames: [],
    breakOnFailure: true,
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}): SessionView {
  return {
    id: "session-1",
    workflowHash: "abc123",
    breakpoints: [],
    breakOnFailure: true,
    config: { envOverrides: {}, vars: {}, secretNames: ["GITHUB_TOKEN"] },
    workflow: {
      jobs: {
        build: { id: "build", steps: [{ key: "gen" }, { key: "step-1" }] },
      },
    },
    ...overrides,
  } as unknown as SessionView;
}

describe("round trip", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it("saves and loads under a workflow-scoped key", () => {
    const value = prefs({ breakpoints: ["build:gen"], vars: { A: "1" } });
    savePrefs("hash-a", value, storage);
    expect(storage.map.has(prefsKey("hash-a"))).toBe(true);
    expect(loadPrefs("hash-a", storage)).toEqual(value);
  });

  it("keeps different workflows from colliding", () => {
    savePrefs("hash-a", prefs({ vars: { WHICH: "a" } }), storage);
    savePrefs("hash-b", prefs({ vars: { WHICH: "b" } }), storage);
    expect(loadPrefs("hash-a", storage)?.vars).toEqual({ WHICH: "a" });
    expect(loadPrefs("hash-b", storage)?.vars).toEqual({ WHICH: "b" });
  });

  it("returns null for a workflow with nothing stored", () => {
    expect(loadPrefs("never-seen", storage)).toBeNull();
  });

  it("clears only the requested workflow", () => {
    savePrefs("hash-a", prefs(), storage);
    savePrefs("hash-b", prefs(), storage);
    clearPrefs("hash-a", storage);
    expect(loadPrefs("hash-a", storage)).toBeNull();
    expect(loadPrefs("hash-b", storage)).not.toBeNull();
  });

  it("treats unavailable storage as a no-op rather than throwing", () => {
    // Private mode / blocked site data: every accessor can throw.
    const hostile: PrefsStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => savePrefs("h", prefs(), hostile)).not.toThrow();
    expect(() => clearPrefs("h", hostile)).not.toThrow();
    expect(loadPrefs("h", hostile)).toBeNull();
    expect(loadPrefs("h", null)).toBeNull();
  });
});

describe("parsePrefs", () => {
  it("rejects junk instead of half-applying it", () => {
    expect(parsePrefs(null)).toBeNull();
    expect(parsePrefs("not json")).toBeNull();
    expect(parsePrefs("[]")).toBeNull();
    expect(parsePrefs('"a string"')).toBeNull();
  });

  it("rejects a payload written by a different version", () => {
    expect(parsePrefs(JSON.stringify({ ...prefs(), version: 2 }))).toBeNull();
  });

  it("rejects payloads with the wrong field shapes", () => {
    expect(parsePrefs(JSON.stringify({ ...prefs(), breakpoints: "build:gen" }))).toBeNull();
    expect(parsePrefs(JSON.stringify({ ...prefs(), vars: { A: 1 } }))).toBeNull();
    expect(parsePrefs(JSON.stringify({ ...prefs(), breakOnFailure: "yes" }))).toBeNull();
  });

  it("accepts a well-formed payload", () => {
    const value = prefs({ breakpoints: ["build:gen"] });
    expect(parsePrefs(JSON.stringify(value))).toEqual(value);
  });
});

describe("prefsFromSession", () => {
  it("never captures secret values, because the client never has them", () => {
    const snapshot = prefsFromSession(
      session({ config: { envOverrides: { A: "1" }, vars: {}, secretNames: ["GITHUB_TOKEN", "DEPLOY_KEY"] } })
    );
    expect(Object.keys(snapshot)).not.toContain("secrets");
    expect(JSON.stringify(snapshot)).not.toContain("value");
    expect(snapshot.envOverrides).toEqual({ A: "1" });
  });

  it("drops the auto-seeded GITHUB_TOKEN from remembered secret names", () => {
    const snapshot = prefsFromSession(
      session({ config: { envOverrides: {}, vars: {}, secretNames: ["GITHUB_TOKEN", "DEPLOY_KEY"] } })
    );
    expect(snapshot.secretNames).toEqual(["DEPLOY_KEY"]);
  });

  it("copies rather than aliasing the session's own objects", () => {
    const s = session({ breakpoints: ["build:gen"] });
    const snapshot = prefsFromSession(s);
    snapshot.breakpoints.push("build:step-1");
    expect(s.breakpoints).toEqual(["build:gen"]);
  });
});

describe("isPristine", () => {
  it("is true for a freshly created session", () => {
    expect(isPristine(session())).toBe(true);
  });

  it("is false once anything worth keeping exists", () => {
    expect(isPristine(session({ breakpoints: ["build:gen"] }))).toBe(false);
    expect(
      isPristine(session({ config: { envOverrides: { A: "1" }, vars: {}, secretNames: [] } }))
    ).toBe(false);
    expect(
      isPristine(session({ config: { envOverrides: {}, vars: { B: "2" }, secretNames: [] } }))
    ).toBe(false);
  });
});

describe("restorableBreakpoints", () => {
  it("keeps breakpoints whose job and step still exist", () => {
    const stored = prefs({ breakpoints: ["build:gen", "build:step-1"] });
    expect(restorableBreakpoints(stored, session())).toEqual(["build:gen", "build:step-1"]);
  });

  it("drops breakpoints pointing at a step or job that is gone", () => {
    const stored = prefs({ breakpoints: ["build:gen", "build:removed", "deleted-job:gen"] });
    expect(restorableBreakpoints(stored, session())).toEqual(["build:gen"]);
  });
});

describe("splitBreakpoint", () => {
  it("splits on the first colon, since step keys may contain one", () => {
    expect(splitBreakpoint("build:gen")).toEqual({ jobId: "build", stepKey: "gen" });
    expect(splitBreakpoint("build:a:b")).toEqual({ jobId: "build", stepKey: "a:b" });
  });

  it("rejects malformed values", () => {
    expect(splitBreakpoint("nocolon")).toBeNull();
    expect(splitBreakpoint(":leading")).toBeNull();
    expect(splitBreakpoint("trailing:")).toBeNull();
  });
});
