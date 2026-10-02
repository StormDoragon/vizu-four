import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { resetRateLimits } from "@/lib/engine/rateLimit";
import { acquireReleaseSlot } from "@/lib/release/limits";
import { releaseFixture } from "@/lib/release/fixtures";
import { ReleaseError } from "@/lib/release/validation";

const { collect, owner } = vi.hoisted(() => ({ collect: vi.fn(), owner: vi.fn() }));
vi.mock("@/lib/release/github", () => ({ collectRelease: collect }));
vi.mock("@/lib/engine/ownership", () => ({ ensureOwnerId: owner }));
const input = { repository: "example/project", base: "v1", head: "main" };
function request(body: unknown = input, headers = {}) { return new Request("http://localhost/api/releases/analyze", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); }
beforeEach(() => { resetRateLimits(); collect.mockReset().mockResolvedValue(releaseFixture()); owner.mockReset().mockResolvedValue("visitor"); vi.stubEnv("ANTHROPIC_API_KEY", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("release API", () => {
  it("returns canonical analysis and both drafts without a key", async () => {
    const response = await POST(request({ ...input, useAi: true }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data.analysis.source).toBe("deterministic"); expect(data.notes.technical).toContain("CSV export"); expect(data.notes.customer).toContain("CSV export");
  });
  it.each([null, [], {}, { ...input, repository: "http://localhost/private" }, { ...input, base: "main...evil" }, { ...input, apiKey: "secret" }])("rejects malformed requests without GitHub calls", async body => { expect((await POST(request(body))).status).toBe(400); expect(collect).not.toHaveBeenCalled(); });
  it("rejects malformed JSON and byte-limited bodies", async () => {
    expect((await POST(new Request("http://localhost/api/releases/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status).toBe(400);
    expect((await POST(request({ ...input, repository: "x".repeat(9000) }))).status).toBe(400);
    expect((await POST(request(input, { "content-length": "9000" }))).status).toBe(400);
    expect(collect).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and non-JSON requests", async () => {
    expect((await POST(request(input, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request(input, { "content-type": "text/plain" }))).status).toBe(415);
    expect(collect).not.toHaveBeenCalled();
    expect((await POST(request(input, { origin: "http://localhost" }))).status).toBe(200);
  });
  it("uses the browser-facing Host behind a reverse proxy", async () => {
    expect((await POST(request(input, { origin: "https://vizu.example", host: "vizu.example" }))).status).toBe(200);
    expect((await POST(request(input, { origin: "https://evil.example", host: "vizu.example" }))).status).toBe(403);
    expect((await POST(request(input, { origin: "null", host: "vizu.example" }))).status).toBe(403);
  });
  it("limits a visitor before collection and returns retry guidance", async () => {
    for (let i = 0; i < 5; i++) expect((await POST(request())).status).toBe(200);
    const response = await POST(request()); expect(response.status).toBe(429); expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0); expect(collect).toHaveBeenCalledTimes(5);
  });
  it("does not spend rate-limit quota on invalid requests", async () => {
    for (let i = 0; i < 10; i++) expect((await POST(request({ ...input, base: "main...evil" }))).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(429);
  });
  it("limits the instance even if cookies and addresses rotate", async () => {
    for (let i = 0; i < 20; i++) { owner.mockResolvedValue(`visitor${i}`); expect((await POST(request(input, { "x-forwarded-for": `10.0.0.${i}` }))).status).toBe(200); }
    owner.mockResolvedValue("another"); expect((await POST(request())).status).toBe(429); expect(collect).toHaveBeenCalledTimes(20);
  });
  it("bounds concurrent collection and restores slots after failure", async () => {
    const first = acquireReleaseSlot()!; const second = acquireReleaseSlot()!;
    try { expect((await POST(request())).status).toBe(429); expect(collect).not.toHaveBeenCalled(); }
    finally { first(); second(); }
    collect.mockRejectedValueOnce(new Error("internal secret"));
    const response = await POST(request()); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("internal secret");
    expect((await POST(request())).status).toBe(200);
  });
  it.each([404, 422, 429, 502, 504])("preserves safe collection status %s", async status => { collect.mockRejectedValue(new ReleaseError(status, "Safe error")); const response = await POST(request()); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: "Safe error" }); });
  it("cancels stalled body streams and releases concurrency", async () => {
    const cancel = vi.fn(); const controller = new AbortController();
    const req = new Request("http://localhost/api/releases/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: new ReadableStream({ cancel }), signal: controller.signal, duplex: "half" } as RequestInit);
    const pending = POST(req); setTimeout(() => controller.abort(), 10);
    expect((await pending).status).toBe(408); expect(cancel).toHaveBeenCalled(); expect(collect).not.toHaveBeenCalled();
    expect((await POST(request())).status).toBe(200);
  });
});
