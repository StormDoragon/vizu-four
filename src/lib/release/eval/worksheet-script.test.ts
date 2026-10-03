import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Runs the real `scripts/release-eval-worksheet.mjs` against a mock GitHub API on loopback. The mock mirrors the
 * checks production makes, so a worksheet is only ever written for a range the product supports.
 */
const SCRIPT = fileURLToPath(new URL("../../../../scripts/release-eval-worksheet.mjs", import.meta.url));
const [A, B, C, D] = ["a", "b", "c", "d"].map(ch => ch.repeat(40));

interface Mock { isPrivate: boolean; fullName: string; status: string; total: unknown; commits: unknown; pulls: Record<string, unknown[]> }
const fresh = (): Mock => ({
  isPrivate: false, fullName: "example/project", status: "ahead", total: 2,
  commits: [{ sha: C, commit: { message: "feat: add CSV export" } }, { sha: D, commit: { message: "Merge pull request #7" } }], pulls: {},
});

let server: Server, base: string, mock: Mock, seen: IncomingHttpHeaders[], dir: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.headers);
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const send = (body: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (path === "/repos/example/project") return send({ private: mock.isPrivate, full_name: mock.fullName });
    if (path.startsWith("/repos/example/project/commits/") && path.endsWith("/pulls")) return send(mock.pulls[path.split("/")[5]] ?? []);
    if (path.startsWith("/repos/example/project/commits/")) return send({ sha: path.endsWith("/v1") ? A : B });
    if (path.startsWith("/repos/example/project/compare/")) return send({ status: mock.status, total_commits: mock.total, commits: mock.commits });
    return send({ message: "not found" }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  dir = mkdtempSync(join(tmpdir(), "vizu-worksheet-"));
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { mock = fresh(); seen = []; });

function run(out: string, extra: string[] = [], env: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, [SCRIPT, "example/project", "v1", "v2", "--out", out, ...extra], { env: { ...process.env, RELEASE_EVAL_TEST_API: base, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? Number((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}
const out = (name: string) => join(dir, `${name}.json`);

describe("release-eval-worksheet.mjs (GitHub API path, mock server)", () => {
  it("writes a worksheet with every label blank for an ahead range, and never sends a token to the mock", async () => {
    const file = out("ahead");
    const result = await run(file, [], { GITHUB_TOKEN: "test-token-not-real" });
    expect(result.code).toBe(0);
    const w = JSON.parse(readFileSync(file, "utf8"));
    expect(w).toMatchObject({ schema: 1, repository: "example/project", baseSha: A, headSha: B, collectedFrom: "github-api", commitCount: 2, review: { reviewer: null, reviewedAt: null, recordUrl: null } });
    expect(w.rows.map((r: { sha: string }) => r.sha)).toEqual([C, D]);
    for (const r of w.rows) { expect(r.label).toEqual({ includeInNotes: null, securitySensitive: null, breakingChange: null, category: null, note: "" }); expect(r.skip).toBeNull(); }
    expect(seen.length).toBeGreaterThan(0);
    for (const headers of seen) expect(headers.authorization).toBeUndefined();
  });
  it.each(["diverged", "behind"])("rejects a %s comparison and writes nothing, as production does", async status => {
    mock.status = status;
    const file = out(`rejected-${status}`);
    const result = await run(file);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Head must descend from base");
    expect(result.stderr).toContain(`"${status}"`);
    expect(existsSync(file)).toBe(false);
  });
  it("rejects an identical comparison: a range with no commits has nothing to label", async () => {
    mock.status = "identical"; mock.total = 0; mock.commits = [];
    const file = out("identical");
    const result = await run(file);
    expect(result.code).not.toBe(0); expect(result.stderr).toContain("The range has no commits");
    expect(existsSync(file)).toBe(false);
  });
  it.each([
    ["a repository that is private", (m: Mock) => { m.isPrivate = true; }, "Public repository not found"],
    ["a repository whose name differs (renamed or case-different owner/repo)", (m: Mock) => { m.fullName = "other/project"; }, "Public repository not found"],
    ["an incomplete commit list", (m: Mock) => { m.total = 3; }, "incomplete commit list"],
    ["a non-numeric total", (m: Mock) => { m.total = "2"; }, "invalid comparison"],
    ["a negative total", (m: Mock) => { m.total = -1; m.commits = []; }, "invalid comparison"],
    ["a missing commit list", (m: Mock) => { m.commits = undefined; }, "invalid comparison"],
  ])("rejects %s and writes nothing", async (name, tweak, message) => {
    tweak(mock);
    const file = out(`bad-${name.slice(0, 12).replace(/\W/g, "")}`);
    const result = await run(file);
    expect(result.code).not.toBe(0); expect(result.stderr).toContain(message);
    expect(existsSync(file)).toBe(false);
  });
  it("rejects a range over the commit limit, and honors --max", async () => {
    const file = out("over-limit");
    expect((await run(file, ["--max", "1"])).stderr).toContain("limit is 1");
    expect(existsSync(file)).toBe(false);
    expect((await run(file, ["--max", "2"])).code).toBe(0);
  });
  it("attaches a merged PR title only when its merge commit is this commit and the base repository matches", async () => {
    mock.pulls[C] = [
      { merged_at: "2026-01-01", merge_commit_sha: D, title: "wrong merge commit", base: { repo: { full_name: "example/project" } } },
      { merged_at: "2026-01-01", merge_commit_sha: C, title: "other repository", base: { repo: { full_name: "other/project" } } },
      { merged_at: null, merge_commit_sha: C, title: "never merged", base: { repo: { full_name: "example/project" } } },
      { merged_at: "2026-01-01", merge_commit_sha: C, title: "feat: add CSV export", base: { repo: { full_name: "Example/Project" } } },
    ];
    mock.pulls[D] = [{ merged_at: "2026-01-01", merge_commit_sha: C, title: "not mine", base: { repo: { full_name: "example/project" } } }];
    const file = out("pulls");
    expect((await run(file)).code).toBe(0);
    const w = JSON.parse(readFileSync(file, "utf8"));
    expect(w.rows.map((r: { pullTitle: string | null }) => r.pullTitle)).toEqual(["feat: add CSV export", null]);
  });
  it("refuses a non-loopback test API, so a token can never be redirected", async () => {
    const result = await run(out("nonloopback"), [], { RELEASE_EVAL_TEST_API: "https://evil.example", GITHUB_TOKEN: "test-token-not-real" });
    expect(result.code).toBe(2); expect(result.stderr).toContain("loopback");
    expect(seen).toEqual([]);
  });
});
