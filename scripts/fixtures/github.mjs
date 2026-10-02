// Test-only preload for the production smoke process. No production import or
// environment switch enables these fixtures; CI passes this module to Node.
import assert from "node:assert/strict";

const base = "a".repeat(40);
const head = "b".repeat(40);
const internal = "c".repeat(40);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "api.github.com") return originalFetch(input, options);
  assert.equal(new Headers(options?.headers).has("authorization"), false);
  assert.equal(options.redirect, "error");
  assert.equal(url.origin, "https://api.github.com");
  const root = "/repos/example/project";
  const responses = new Map([
    [root, { private: false, full_name: "example/project" }],
    [`${root}/commits/release%2Fv1`, { sha: base }],
    [`${root}/commits/main`, { sha: head }],
    [`${root}/compare/${base}...${head}?per_page=100&page=1`, {
      status: "ahead", total_commits: 2,
      commits: [
        { sha: head, commit: { message: "feat: add CSV export\r\n\r\nSupports Unicode names." } },
        { sha: internal, commit: { message: "ci: update Linux runner" } },
      ],
      files: [{ filename: "src/Report é.ts", status: "modified" }],
    }],
    [`${root}/commits/${head}/pulls?per_page=10&page=1`, [{
      number: 7, merged_at: "2026-09-01T00:00:00Z", merge_commit_sha: head,
      title: "feat: add CSV export", base: { repo: { full_name: "example/project" } },
    }]],
    [`${root}/commits/${internal}/pulls?per_page=10&page=1`, []],
  ]);
  const key = url.pathname + url.search;
  assert.ok(responses.has(key), `Unexpected GitHub request: ${key}`);
  return Response.json(responses.get(key));
};
