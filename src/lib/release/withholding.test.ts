import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeRelease, renderNotes } from "./analysis";
import { releaseFixture } from "./fixtures";
import { generateReleaseWording } from "./generate";
import { aiBudgetUsage, resetAiBudget } from "../ai/budget";

// The provider SDK is mocked: nothing here can reach a paid API.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));
beforeEach(() => { resetAiBudget(); vi.clearAllMocks(); vi.stubEnv("ANTHROPIC_API_KEY", "test-private-key"); });
afterEach(() => { resetAiBudget(); vi.unstubAllEnvs(); });

/** Distinctive wording so a leak into notes or prompts is unambiguous. */
const SECURITY_INPUTS = [
  "Stop a timing attack on the zebra login", "Fix buffer overflow in the zebra decoder", "Prevent zip slip in zebra archives", "Fix prototype pollution in zebra merge",
  "Replace unsafe deserialization of zebra cookies", "Fix insecure deserialization in the zebra importer", "Secrets exposure in zebra build logs", "Password disclosure through zebra error pages",
  "API key leak in zebra crash reports", "Session token exposure in the zebra referrer", "Bearer tokens logged on zebra 401s", "Access keys dumped by the zebra debug endpoint",
  "Stop printing the zebra private key", "zebra API-key leaked in logs", `zebra API${String.fromCodePoint(0x2011)}key leaked in logs`, "zebra apikey exposed in logs", "Remove zebra API keys from the logs", "Stop logging zebra API keys", "Remove hardcoded secret from the zebra deploy script", "Credentials hard-coded in the zebra sample config", "Stop leaking\nzebra API keys in logs",
];
const SAFE = "feat: add CSV export";
const BREAKING = "Drop support for Node 16";

describe("security-sensitive wording is withheld", () => {
  const analysis = analyzeRelease(releaseFixture([...SECURITY_INPUTS, SAFE]));

  it("flags every security input and leaves the ordinary change unflagged", () => {
    SECURITY_INPUTS.forEach((text, i) => expect(analysis.changes[i], text).toMatchObject({ securitySensitive: true, category: "security", importance: "high" }));
    expect(analysis.changes.at(-1)).toMatchObject({ securitySensitive: false, category: "added" });
  });
  it("keeps the source text out of both rendered notes", () => {
    const notes = renderNotes(analysis);
    for (const audience of [notes.technical, notes.customer]) {
      expect(audience).not.toContain("zebra");
      expect(audience).toContain("CSV export");
    }
    expect(notes.customer).toContain("details are withheld");
    expect(notes.technical).toContain("Security-related change — maintainer review required.");
    expect(notes.customer).not.toContain("Security-related change");
  });
  it("sends only non-security changes to the AI, with no paid call", async () => {
    create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ changes: [{ id: analysis.changes.at(-1)!.id, technical: "Added CSV export.", customer: "Export your data as CSV.", evidenceIds: [analysis.changes.at(-1)!.evidence[0].id] }] }) }] });
    const result = await generateReleaseWording(analysis, true);
    expect(result.source).toBe("claude");
    expect(create).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(create.mock.calls[0][0]);
    expect(prompt).not.toContain("zebra"); expect(prompt).not.toContain("test-private-key"); expect(prompt).toContain("CSV export");
    // Rewritten wording applies only to the eligible change; security changes keep their canonical fields.
    expect(result.changes.slice(0, SECURITY_INPUTS.length)).toEqual(analysis.changes.slice(0, SECURITY_INPUTS.length));
  });
  it("makes no AI call at all when every release-worthy change is security-sensitive", async () => {
    const onlySecurity = analyzeRelease(releaseFixture(SECURITY_INPUTS));
    expect(await generateReleaseWording(onlySecurity, true)).toBe(onlySecurity);
    expect(create).not.toHaveBeenCalled(); expect(aiBudgetUsage().calls).toBe(0);
  });
});

describe("breaking changes stay visible and are marked for the AI", () => {
  it("renders the breaking change and passes breakingChange to the prompt", async () => {
    const analysis = analyzeRelease(releaseFixture([BREAKING, SAFE]));
    expect(analysis.changes[0]).toMatchObject({ breakingChange: true, category: "breaking", securitySensitive: false });
    expect(renderNotes(analysis).customer).toContain("breaking");
    create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] });
    await generateReleaseWording(analysis, true);
    const prompt = JSON.stringify(create.mock.calls[0][0]);
    expect(prompt).toContain('breakingChange\\":true');
  });
});
