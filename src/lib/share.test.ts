import { describe, expect, it } from "vitest";
import {
  buildSharePayload,
  buildShareUrl,
  decodeSharePayload,
  encodeSharePayload,
  tokenFromHash,
  validateSharePayload,
  type SharePayload,
} from "./share";
import { makeSessionView } from "@/components/testSupport/sessionFixture";
import type { Lane } from "@/lib/engine/types";

function payload(overrides: Partial<SharePayload> = {}): SharePayload {
  return {
    version: 1,
    yaml: "name: CI\non: push\njobs: {}",
    breakpoints: [],
    env: {},
    vars: {},
    breakOnFailure: true,
    mockOutputs: {},
    progress: [],
    activeLane: null,
    ...overrides,
  };
}

describe("encodeSharePayload / decodeSharePayload", () => {
  it("round-trips a payload", () => {
    const p = payload({ breakpoints: ["build:step-0"], env: { FOO: "bar" } });
    const token = encodeSharePayload(p);
    expect(decodeSharePayload(token)).toEqual(p);
  });

  it("round-trips non-ASCII text in the yaml", () => {
    const p = payload({ yaml: "name: 🚀 déploiement\non: push\njobs: {}" });
    expect(decodeSharePayload(encodeSharePayload(p))).toEqual(p);
  });

  it("is URL-safe (no +, /, or = characters)", () => {
    const token = encodeSharePayload(payload({ env: { KEY: "value+with/special=chars" } }));
    expect(token).not.toMatch(/[+/=]/);
  });

  it("round-trips lane progress, the active lane, and mocked outputs", () => {
    const p = payload({
      progress: [
        { jobId: "setup", matrix: {}, stepIndex: 2 },
        { jobId: "build", matrix: { node: 18 }, stepIndex: 1 },
      ],
      activeLane: { jobId: "build", matrix: { node: 18 } },
      mockOutputs: { "build:step-0": { outputs: { result: "ok" }, exitCode: 1, stderr: "boom" } },
    });
    expect(decodeSharePayload(encodeSharePayload(p))).toEqual(p);
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(decodeSharePayload("not-a-valid-token!!!")).toBe(null);
    expect(decodeSharePayload("")).toBe(null);
  });

  it("returns null for a well-formed-but-wrong-shape token", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const token = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeSharePayload(token)).toBe(null);
  });
});

describe("buildShareUrl / tokenFromHash", () => {
  it("puts the token in the fragment, which browsers never send to the server", () => {
    const token = encodeSharePayload(payload());
    const url = new URL(buildShareUrl("https://example.test", token));
    expect(url.pathname).toBe("/share");
    expect(url.search).toBe("");
    expect(decodeSharePayload(tokenFromHash(url.hash))).toEqual(payload());
  });

  it("reads no token from an empty hash", () => {
    expect(tokenFromHash("")).toBe("");
    expect(tokenFromHash("#")).toBe("");
  });
});

describe("validateSharePayload", () => {
  it("rejects a future/unknown version", () => {
    expect(validateSharePayload({ ...payload(), version: 2 })).toBe(null);
  });

  it("drops any extra field (e.g. a smuggled-in 'secrets') rather than passing it through", () => {
    // The validator only ever reads the known-safe fields back out, so an
    // extra field on the decoded object - however it got there - can't
    // survive into the value the rest of the app trusts.
    const withExtra = { ...payload(), secrets: { TOKEN: "leaked" } };
    const validated = validateSharePayload(withExtra);
    expect(validated).not.toHaveProperty("secrets");
    expect(validated).toEqual(payload());
  });

  it("rejects malformed mockOutputs", () => {
    expect(validateSharePayload({ ...payload(), mockOutputs: { "build:step-0": { outputs: "not an object" } } })).toBe(
      null
    );
  });

  it("rejects malformed progress entries", () => {
    expect(validateSharePayload({ ...payload(), progress: [{ jobId: "build" }] })).toBe(null);
  });

  it("rejects a malformed activeLane", () => {
    expect(validateSharePayload({ ...payload(), activeLane: { jobId: "build" } })).toBe(null);
  });
});

describe("buildSharePayload", () => {
  function lane(overrides: Partial<Lane> = {}): Lane {
    return {
      id: "build::node-18",
      jobId: "build",
      matrix: { node: 18 },
      status: "ready",
      pointer: 0,
      steps: [],
      env: {},
      extraPath: [],
      outputs: {},
      tempDir: "/tmp/fixture",
      ...overrides,
    };
  }

  it("never includes secret names or values", () => {
    const l = lane({ pointer: 2 });
    const session = makeSessionView({
      lanes: { [l.id]: l },
      laneOrder: [l.id],
      activeLaneId: l.id,
      config: {
        eventName: "push",
        event: {},
        ref: "refs/heads/main",
        sha: "0".repeat(40),
        actor: "octocat",
        repository: "octocat/hello-world",
        runId: "1",
        runNumber: "1",
        workflowInputs: {},
        vars: {},
        secretNames: ["TOKEN"],
        envOverrides: { FOO: "bar" },
      },
    });
    const p = buildSharePayload(session, "name: CI");
    expect(p).not.toHaveProperty("secretNames");
    expect(p).not.toHaveProperty("secrets");
    expect(JSON.stringify(p)).not.toContain("TOKEN");
    expect(p.env).toEqual({ FOO: "bar" });
  });

  it("includes only lanes with progress past their start, keyed by job + matrix combo", () => {
    const laneA = lane({ id: "setup::default", jobId: "setup", matrix: {}, pointer: 2 });
    const laneB = lane({ id: "build::node-18", jobId: "build", matrix: { node: 18 }, pointer: 0 });
    const session = makeSessionView({
      lanes: { [laneA.id]: laneA, [laneB.id]: laneB },
      laneOrder: [laneA.id, laneB.id],
      activeLaneId: laneB.id,
    });
    const p = buildSharePayload(session, "name: CI");
    expect(p.progress).toEqual([{ jobId: "setup", matrix: {}, stepIndex: 2 }]);
  });

  it("records the active lane by job + matrix combo even when its pointer is 0", () => {
    const l = lane({ pointer: 0 });
    const session = makeSessionView({ lanes: { [l.id]: l }, laneOrder: [l.id], activeLaneId: l.id });
    const p = buildSharePayload(session, "name: CI");
    expect(p.activeLane).toEqual({ jobId: "build", matrix: { node: 18 } });
    expect(p.progress).toEqual([]);
  });

  it("has no active lane when there is none", () => {
    const session = makeSessionView({ activeLaneId: null });
    const p = buildSharePayload(session, "name: CI");
    expect(p.activeLane).toBe(null);
  });
});
