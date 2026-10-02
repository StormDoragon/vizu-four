import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeRelease } from "./analysis";
import { releaseFixture } from "./fixtures";
import { generateReleaseWording, parseReleaseWording } from "./generate";
import { acquireAiCall, aiBudgetUsage, resetAiBudget } from "../ai/budget";

const { create, construct } = vi.hoisted(() => ({ create: vi.fn(), construct: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; constructor(options: unknown) { construct(options); } } }));
const analysis = analyzeRelease(releaseFixture(["feat: add CSV export", "fix!: security bypass", "ci: test"]));
function wording() { return { changes: [{ id: analysis.changes[0].id, technical: "Added CSV export.", customer: "Export your data as CSV.", evidenceIds: [analysis.changes[0].evidence[0].id] }] }; }
beforeEach(() => { resetAiBudget(); vi.clearAllMocks(); vi.stubEnv("ANTHROPIC_API_KEY", "test-private-key"); });
afterEach(() => { resetAiBudget(); vi.unstubAllEnvs(); });

describe("untrusted AI response", () => {
  it("accepts wording while preserving every canonical field and evidence object", () => {
    const result = parseReleaseWording(JSON.stringify(wording()), analysis)!;
    expect(result.source).toBe("claude");
    expect(result.changes[0]).toEqual({ ...analysis.changes[0], technical: "Added CSV export.", customer: "Export your data as CSV." });
    expect(result.changes[1]).toEqual(analysis.changes[1]);
    expect(result.changes[0].evidence).toBe(analysis.changes[0].evidence);
  });
  it.each(["null", "[]", "{}", "not JSON", '{"changes":[null]}', '{"changes":[]}', "x".repeat(32001)])("rejects malformed or unbounded output", text => expect(parseReleaseWording(text, analysis)).toBeNull());
  it.each([
    { evidenceIds: ["pr:999"] }, { evidenceIds: [analysis.changes[1].evidence[0].id] }, { evidenceIds: [] },
    { id: "invented" }, { id: analysis.changes[1].id }, { category: "security" }, { releaseWorthy: false },
    { technical: {} }, { technical: "" }, { customer: "x".repeat(601) }, { customer: "Click https://evil.test" },
    { customer: "See PR #999" }, { customer: "<script>alert(1)</script>" }, { customer: "[link](evil)" },
  ])("rejects forged fields, evidence, or unsafe prose", override => {
    const data = wording(); Object.assign(data.changes[0], override);
    expect(parseReleaseWording(JSON.stringify(data), analysis)).toBeNull();
  });
  it("rejects duplicate changes and omitted items", () => {
    const two = analyzeRelease(releaseFixture(["feat: one", "fix: two"]));
    const data = wording(); data.changes.push(data.changes[0]);
    expect(parseReleaseWording(JSON.stringify(data), two)).toBeNull();
    expect(parseReleaseWording(JSON.stringify(wording()), two)).toBeNull();
  });
  it("masks model-echoed operator credentials", () => {
    const data = wording(); data.changes[0].technical = "test-private-key";
    expect(parseReleaseWording(JSON.stringify(data), analysis)?.changes[0].technical).toBe("***");
  });
});

describe("AI budgets and fallback", () => {
  it("does not spend without consent, a key, or eligible changes", async () => {
    expect(await generateReleaseWording(analysis, false)).toBe(analysis);
    expect(await generateReleaseWording(analyzeRelease(releaseFixture(["ci: tooling"])), true)).toMatchObject({ source: "deterministic" });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await generateReleaseWording(analysis, true)).toMatchObject({ source: "deterministic", changes: analysis.changes });
    expect(create).not.toHaveBeenCalled(); expect(aiBudgetUsage().calls).toBe(0);
  });
  it("uses the debugger's shared budget, disables retries, and applies one deadline", async () => {
    create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(wording()) }] });
    const result = await generateReleaseWording(analysis, true);
    expect(result.source).toBe("claude");
    expect(construct).toHaveBeenCalledWith({ apiKey: "test-private-key", maxRetries: 0 });
    expect(create.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    const prompt = JSON.stringify(create.mock.calls[0][0]);
    expect(prompt).not.toContain("test-private-key"); expect(prompt).not.toContain("security bypass"); expect(prompt).not.toContain("ci: test");
    expect(aiBudgetUsage()).toEqual({ calls: 1, inFlight: 0 });
  });
  it("falls back when shared spend or concurrency is exhausted", async () => {
    vi.stubEnv("VIZU_AI_MAX_CONCURRENT", "1");
    const lease = acquireAiCall();
    expect((await generateReleaseWording(analysis, true)).source).toBe("deterministic");
    if (typeof lease !== "string") lease.release();
    vi.stubEnv("VIZU_AI_MAX_CALLS_PER_WINDOW", "1");
    expect((await generateReleaseWording(analysis, true)).source).toBe("deterministic");
    expect(create).not.toHaveBeenCalled();
  });
  it.each([null, { stop_reason: "max_tokens", content: [{ type: "text", text: JSON.stringify(wording()) }] }, { stop_reason: "end_turn", content: [] }, { stop_reason: "end_turn", content: [{ type: "text", text: "bad" }] }])("releases capacity after invalid replies", async value => {
    create.mockResolvedValue(value);
    expect((await generateReleaseWording(analysis, true)).source).toBe("deterministic");
    expect(aiBudgetUsage().inFlight).toBe(0);
  });
  it("falls back on provider failures without exposing their details", async () => {
    create.mockRejectedValue(new Error("test-private-key provider detail"));
    const result = await generateReleaseWording(analysis, true);
    expect(result.source).toBe("deterministic"); expect(JSON.stringify(result)).not.toContain("test-private-key"); expect(aiBudgetUsage().inFlight).toBe(0);
  });
  it("aborts the provider and frees the slot on deadline", async () => {
    vi.stubEnv("VIZU_AI_TIMEOUT_MS", "10");
    create.mockImplementation((_body, options) => new Promise((_, reject) => { options.signal.addEventListener("abort", () => reject(new Error("aborted"))); }));
    expect((await generateReleaseWording(analysis, true)).source).toBe("deterministic");
    expect(create.mock.calls[0][1].signal.aborted).toBe(true);
    expect(aiBudgetUsage().inFlight).toBe(0);
  });
  it("does not spend on an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await generateReleaseWording(analysis, true, controller.signal)).source).toBe("deterministic"); expect(create).not.toHaveBeenCalled();
  });
});
