import { describe, expect, it, vi } from "vitest";
import { collectRelease, MAX_GITHUB_BYTES, MAX_GITHUB_REQUESTS } from "./github";
import { releaseFixture } from "./fixtures";
import { analyzeRelease } from "./analysis";

const input = { repository: "example/project", base: "release/v1", head: "main", useAi: false };
const fixture = releaseFixture(["feat: add export"]);
function comparison() { return { status: "ahead", total_commits: fixture.commits.length, commits: fixture.commits.map(c => ({ sha: c.sha, commit: { message: c.message } })), files: [{ filename: "src/file name.ts", status: "modified" }, { filename: "old.ts", status: "removed" }] }; }
function setup(compare: unknown = comparison(), pulls: unknown = []) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ private: false, full_name: "example/project" })).mockResolvedValueOnce(Response.json({ sha: fixture.baseSha })).mockResolvedValueOnce(Response.json({ sha: fixture.headSha })).mockResolvedValueOnce(Response.json(compare)).mockImplementation(async () => Response.json(pulls));
}
function pr(overrides = {}) { return { number: 7, merged_at: "2026-09-01", merge_commit_sha: fixture.commits[0].sha, title: "feat: export reports", base: { repo: { full_name: "example/project" } }, html_url: "https://evil.test/", ...overrides }; }

describe("public GitHub collection", () => {
  it("pins refs, uses fixed-origin unauthenticated requests, and builds its own links", async () => {
    const fetcher = setup(comparison(), [pr()]);
    const result = await collectRelease(input, fetcher);
    expect(fetcher.mock.calls[1][0]).toContain("/commits/release%2Fv1");
    expect(fetcher.mock.calls[3][0]).toContain(`${fixture.baseSha}...${fixture.headSha}`);
    for (const [url, options] of fetcher.mock.calls) { expect(String(url)).toMatch(/^https:\/\/api.github.com\/repos\/example\/project/); expect(options).toMatchObject({ redirect: "error", cache: "no-store" }); expect(new Headers(options?.headers).has("authorization")).toBe(false); expect(options?.signal).toBeInstanceOf(AbortSignal); }
    expect(result.commits[0].pullTitle).toBe("feat: export reports");
    expect(result.commits[0].evidence[1].url).toBe("https://github.com/example/project/pull/7");
    expect(result.files[0].url).toContain(`/blob/${fixture.headSha}/src/file%20name.ts`);
    expect(result.files[1].url).toContain(`/blob/${fixture.baseSha}/old.ts`);
    expect(result.commits[0].evidence.some(e => e.kind === "file")).toBe(false);
  });
  it("produces the same canonical analysis for LF and CRLF commit metadata", async () => {
    const compare = comparison();
    compare.commits[0].commit.message = "feat: add export\n\nBREAKING CHANGE: replace format";
    const lf = await collectRelease(input, setup(compare));
    compare.commits[0].commit.message = compare.commits[0].commit.message.replace(/\n/g, "\r\n");
    const crlf = await collectRelease(input, setup(compare));
    expect(analyzeRelease(crlf)).toEqual(analyzeRelease(lf));
    expect(analyzeRelease(crlf).changes[0].breakingChange).toBe(true);
  });
  it("detects markers across LF, CRLF and wrapped lines identically at collection time", async () => {
    for (const [message, flag] of [["fix: x\n\nStop leaking\nAPI keys in logs", "securitySensitive"], ["feat: x\n\nThis is not\nbackwards compatible", "breakingChange"]] as const) {
      const compare = comparison();
      compare.commits[0].commit.message = message;
      const lf = await collectRelease(input, setup(compare));
      for (const eol of ["\r\n", "\r"]) {
        compare.commits[0].commit.message = message.replace(/\n/g, eol);
        const other = await collectRelease(input, setup(compare));
        expect(other.commits[0].reviewFlags, `${flag} with ${JSON.stringify(eol)}`).toEqual(lf.commits[0].reviewFlags);
      }
      expect(lf.commits[0].reviewFlags?.[flag]).toBe(true);
    }
  });
  it("keeps a late bare-CR footer after truncation", async () => {
    const compare = comparison();
    compare.commits[0].commit.message = "feat: change\r" + "x".repeat(1300) + "\rBREAKING CHANGE: replace format";
    const result = await collectRelease(input, setup(compare));
    expect(result.commits[0].message.length).toBeLessThanOrEqual(1200);
    expect(result.commits[0].message).not.toContain("BREAKING CHANGE");
    expect(result.commits[0].reviewFlags).toEqual({ securitySensitive: false, breakingChange: true });
    expect(analyzeRelease(result).changes[0]).toMatchObject({ breakingChange: true, category: "breaking" });
    expect(result.warnings.join()).toContain("truncated");
  });
  it("encodes GitHub file paths without host-platform path normalization", async () => {
    const filenames = ["src/Report é.ts", "src/report é.ts", "docs/a#b?.md", "src/back\\slash.ts"];
    const result = await collectRelease(input, setup({ ...comparison(), files: filenames.map(filename => ({ filename, status: "modified" })) }));
    expect(result.files.map(file => file.url)).toEqual([
      "src/Report%20%C3%A9.ts", "src/report%20%C3%A9.ts", "docs/a%23b%3F.md", "src/back%5Cslash.ts",
    ].map(path => `https://github.com/example/project/blob/${fixture.headSha}/${path}`));
  });
  it.each([pr({ merged_at: null }), pr({ merge_commit_sha: "c".repeat(40) }), pr({ base: { repo: { full_name: "other/project" } } }), pr({ number: -1 })])("rejects unrelated PR evidence", async pull => expect((await collectRelease(input, setup(comparison(), [pull]))).commits[0].evidence).toHaveLength(1));
  it("rejects unsafe input before any fetch", async () => { const fetcher = setup(); await expect(collectRelease({ ...input, repository: "https://evil.test/a/b" }, fetcher)).rejects.toMatchObject({ status: 400 }); expect(fetcher).not.toHaveBeenCalled(); });
  it("requires public repository metadata", async () => { const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ private: true, full_name: input.repository })); await expect(collectRelease(input, fetcher)).rejects.toMatchObject({ status: 404 }); expect(fetcher).toHaveBeenCalledTimes(1); });
  it.each([[404, 404], [403, 429], [429, 429], [422, 422], [409, 422], [500, 502]])("maps GitHub %s safely", async (upstream, status) => { const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("SECRET provider error", { status: upstream })); await expect(collectRelease(input, fetcher)).rejects.toMatchObject({ status }); await expect(collectRelease(input, vi.fn<typeof fetch>().mockRejectedValue(new Error("SECRET")))).rejects.not.toThrow("SECRET"); });
  it("rejects redirects at fetch and hides network errors", async () => { const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("redirect to http://localhost")); await expect(collectRelease(input, fetcher)).rejects.toThrow("Unable to read GitHub data"); });
  it.each(["behind", "diverged"])("rejects %s comparison", async status => await expect(collectRelease(input, setup({ ...comparison(), status }))).rejects.toMatchObject({ status: 422 }));
  it("accepts identical refs with no changes", async () => expect((await collectRelease(input, setup({ status: "identical", total_commits: 0, commits: [], files: [] }))).commits).toEqual([]));
  it("rejects over-limit and incomplete comparisons instead of presenting partial notes", async () => {
    await expect(collectRelease(input, setup({ ...comparison(), total_commits: 41 }))).rejects.toMatchObject({ status: 422 });
    await expect(collectRelease(input, setup({ ...comparison(), total_commits: 2 }))).rejects.toMatchObject({ status: 502 });
  });
  it.each([{ status: "ahead", commits: [], total_commits: -1 }, { ...comparison(), commits: [{ sha: "bad", commit: { message: "feat: fake" } }] }, { ...comparison(), commits: [{ sha: fixture.commits[0].sha, commit: { message: {} } }] }, { ...comparison(), total_commits: 2, commits: [...comparison().commits, ...comparison().commits] }])("rejects malformed comparison data", async data => await expect(collectRelease(input, setup(data))).rejects.toMatchObject({ status: 502 }));
  it("caps PR enrichment and total requests with a visible warning", async () => {
    const commits = releaseFixture(Array.from({ length: 40 }, () => "fix: repair thing")).commits.map(c => ({ sha: c.sha, commit: { message: c.message } }));
    const fetcher = setup({ ...comparison(), total_commits: 40, commits });
    const result = await collectRelease(input, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(MAX_GITHUB_REQUESTS);
    expect(result.commits).toHaveLength(40);
    expect(result.warnings.join()).toContain("first 10 commits");
  });
  it("falls back to commits when enrichment fails", async () => {
    const fetcher = setup(); fetcher.mockRejectedValue(new Error("upstream secret"));
    const result = await collectRelease(input, fetcher);
    expect(result.commits).toHaveLength(1); expect(result.warnings.join()).toContain("enrichment stopped"); expect(JSON.stringify(result)).not.toContain("upstream secret");
  });
  it("warns about comparison file truncation", async () => expect((await collectRelease(input, setup({ ...comparison(), files: Array.from({ length: 300 }, (_, i) => ({ filename: `file${i}`, status: "added" })) }))).warnings.join()).toContain("300"));
  it("omits traversal file paths", async () => expect((await collectRelease(input, setup({ ...comparison(), files: [{ filename: "../secret" }] }))).files).toEqual([]));
  it("preserves review signals beyond the displayed message cap", async () => {
    const compare = comparison(); compare.commits[0].commit.message = "feat: change\n" + "x".repeat(1300) + "\nBREAKING CHANGE: security policy";
    const result = await collectRelease(input, setup(compare));
    expect(result.commits[0].message.length).toBe(1200);
    expect(result.warnings.join()).toContain("truncated");
    expect(analyzeRelease(result).changes[0]).toMatchObject({ breakingChange: true, securitySensitive: true });
  });
  it("bounds declared and streamed GitHub response bytes", async () => {
    for (const response of [new Response("{}", { headers: { "Content-Length": String(MAX_GITHUB_BYTES + 1) } }), new Response("x".repeat(MAX_GITHUB_BYTES + 1))]) {
      await expect(collectRelease(input, vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toMatchObject({ status: 422 });
    }
  });
  it("honors cancellation and sanitizes malformed JSON", async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_, options) => { options?.signal?.throwIfAborted(); return Response.json({}); });
    await expect(collectRelease(input, fetcher, controller.signal)).rejects.toMatchObject({ status: 504 });
    await expect(collectRelease(input, vi.fn<typeof fetch>().mockResolvedValue(new Response("secret not JSON")))).rejects.toMatchObject({ status: 502 });
  });
});
