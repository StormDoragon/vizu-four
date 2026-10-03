#!/usr/bin/env node
// Writes a labeling worksheet for a real, PUBLIC GitHub release range. Every label is left blank.
//
//   node scripts/release-eval-worksheet.mjs <owner/repo> <base-ref> <head-ref> [--out <file>] [--max <n>] [--local <clone-dir>] [--role calibration|holdout]
//
// --role records what the labeled range is for. A "holdout" range must be labeled AFTER any rule changes and never
// used to tune rules; an absent role means calibration. It is recorded in the worksheet, not enforced here.
//
// --local reads the range from a local git clone instead of the GitHub API: no network, no rate limit, identical
// SHAs and raw messages, but no merged-PR titles (pullTitle stays null). You are responsible for the repository being
// public and for the clone matching <owner/repo>; the worksheet records where its data came from.
//
// Why blank: pre-filling labels with this project's own classifier output would make the later comparison
// circular. The maintainer decides, then the classifier is scored against those decisions.
//
// Only raw GitHub data is written (messages, PR titles). Masking, truncation and flag detection are applied
// when a completed worksheet is imported (src/lib/release/eval/reviewed.ts), so evaluation sees what the
// product would see. Reads are unauthenticated unless GITHUB_TOKEN is set (it is only sent to api.github.com, and a
// rejected token falls back to unauthenticated).
// Run it on a trusted machine; it makes ~2 + N requests for N commits.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Test hook: a loopback URL replaces the API so the script can be exercised against a mock server. It can only
// point at 127.0.0.1/localhost, and a GITHUB_TOKEN is NEVER sent to it.
const testApi = process.env.RELEASE_EVAL_TEST_API;
if (testApi && !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(testApi)) { console.error("RELEASE_EVAL_TEST_API must be a loopback URL."); process.exit(2); }
const API = testApi || "https://api.github.com";
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i === -1) return undefined; const [, value] = args.splice(i, 2); return value; };
const out = flag("--out");
const maxCommits = Number(flag("--max") ?? 40);
const localDir = flag("--local");
const role = flag("--role");
const [repository, baseRef, headRef] = args;
if (!repository || !baseRef || !headRef || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 100 || (role !== undefined && !["calibration", "holdout"].includes(role))) {
  console.error("usage: node scripts/release-eval-worksheet.mjs <owner/repo> <base-ref> <head-ref> [--out <file>] [--max <1-100>] [--local <clone-dir>] [--role calibration|holdout]");
  process.exit(2);
}

let useToken = Boolean(process.env.GITHUB_TOKEN) && !testApi;
async function get(path) {
  const request = authenticated => {
    const headers = { accept: "application/vnd.github+json", "user-agent": "vizu-release-eval-worksheet", "x-github-api-version": "2022-11-28" };
    if (authenticated) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return fetch(`${API}/repos/${repository}${path}`, { headers, redirect: "error" });
  };
  let response = await request(useToken);
  if (response.status === 401 && useToken) {
    // Public data does not need a token; a stale or wrong one must not block the run. The value is never printed.
    console.error("GITHUB_TOKEN was rejected (401); continuing unauthenticated, which is enough for public repositories.");
    useToken = false;
    response = await request(false);
  }
  if (!response.ok) throw new Error(`GitHub ${response.status} for ${path || "/"}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

const git = (...gitArgs) => execFileSync("git", ["-C", localDir, ...gitArgs], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

async function collectFromApi() {
  const repo = await get("");
  if (repo.private !== false || typeof repo.full_name !== "string" || repo.full_name.toLowerCase() !== repository.toLowerCase()) throw new Error("Public repository not found (it must be public and match owner/repo exactly).");
  const resolve = async ref => { const c = await get(`/commits/${encodeURIComponent(ref)}`); if (!/^[0-9a-f]{40}$/.test(c.sha)) throw new Error(`Could not resolve ${ref}`); return c.sha; };
  const [baseSha, headSha] = [await resolve(baseRef), await resolve(headRef)];
  const compare = await get(`/compare/${baseSha}...${headSha}?per_page=100&page=1`);
  // Same rule as the product: the head must descend from the base. "behind" and "diverged" ranges are not supported.
  if (!["ahead", "identical"].includes(String(compare.status))) throw new Error(`Head must descend from base (GitHub reports the comparison as "${compare.status}"). Choose an ancestor base ref.`);
  if (!Number.isSafeInteger(compare.total_commits) || compare.total_commits < 0 || !Array.isArray(compare.commits)) throw new Error("GitHub returned an invalid comparison.");
  if (compare.total_commits === 0) throw new Error("The range has no commits.");
  if (compare.total_commits > maxCommits) throw new Error(`The range has ${compare.total_commits} commits; the limit is ${maxCommits}. Choose a smaller range (or raise --max, up to 100).`);
  if (compare.commits.length !== compare.total_commits) throw new Error("GitHub returned an incomplete commit list.");
  const rows = [];
  for (const item of compare.commits) {
    // Same rule as the product: a merged PR whose merge commit is THIS commit, in this repository.
    let pullTitle = null;
    const pulls = await get(`/commits/${item.sha}/pulls?per_page=10&page=1`);
    for (const pr of pulls) {
      if (pr.merged_at && pr.merge_commit_sha === item.sha && typeof pr.title === "string" && pr.base?.repo?.full_name?.toLowerCase() === repository.toLowerCase()) { pullTitle = pr.title; break; }
    }
    rows.push({ sha: item.sha, message: item.commit.message, pullTitle });
  }
  return { baseSha, headSha, rows, collectedFrom: "github-api" };
}

function collectFromLocal() {
  const resolve = ref => { const sha = git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).trim(); if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Could not resolve ${ref} in ${localDir}`); return sha; };
  const [baseSha, headSha] = [resolve(baseRef), resolve(headRef)];
  try { git("merge-base", "--is-ancestor", baseSha, headSha); } catch { throw new Error("The base commit is not an ancestor of the head commit."); }
  const shas = git("rev-list", "--reverse", `${baseSha}..${headSha}`).split("\n").filter(Boolean);
  if (shas.length === 0) throw new Error("The range has no commits.");
  if (shas.length > maxCommits) throw new Error(`The range has ${shas.length} commits; the limit is ${maxCommits}. Choose a smaller range (or raise --max, up to 100).`);
  // git adds one trailing newline that GitHub's commit.message does not have.
  const rows = shas.map(sha => ({ sha, message: git("show", "-s", "--format=%B", sha).replace(/\n$/, ""), pullTitle: null }));
  return { baseSha, headSha, rows, collectedFrom: "local-git" };
}

const collected = localDir ? collectFromLocal() : await collectFromApi();
const { baseSha, headSha, collectedFrom } = collected;
const rows = collected.rows.map(r => ({
  ...r, url: `https://github.com/${repository}/commit/${r.sha}`,
  label: { includeInNotes: null, securitySensitive: null, breakingChange: null, category: null, note: "" }, skip: null,
}));

const worksheet = {
  schema: 1, ...(role ? { role } : {}), repository, baseRef, headRef, baseSha, headSha, collectedFrom, generatedAt: new Date().toISOString(), commitCount: rows.length,
  review: { reviewer: null, reviewedAt: null, recordUrl: null }, rows,
};
const file = out ?? `release-eval-${repository.replace("/", "-")}-${baseSha.slice(0, 7)}-${headSha.slice(0, 7)}.json`;
writeFileSync(file, JSON.stringify(worksheet, null, 2) + "\n");
console.log(`Wrote ${file}: ${rows.length} commits, ${rows.filter(r => r.pullTitle).length} with a merged PR title (${collectedFrom}). All labels are blank.`);
