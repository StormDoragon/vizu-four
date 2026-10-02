import type { CollectedCommit, Evidence, ReleaseCollection, ReleaseInput } from "./types";
import { parseReleaseInput, ReleaseError } from "./validation";
import { releaseText } from "./text";
import { reviewFlags } from "./analysis";

export const MAX_COMMITS = 40;
export const MAX_PR_LOOKUPS = 10;
export const MAX_GITHUB_REQUESTS = 14;
export const MAX_GITHUB_BYTES = 2 * 1024 * 1024;
export const GITHUB_DEADLINE_MS = 15_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReleaseError(502, "GitHub returned unexpected data.");
  return value as Record<string, unknown>;
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) throw new ReleaseError(502, "GitHub returned an invalid commit identifier.");
  return value;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_GITHUB_BYTES) {
    await response.body?.cancel();
    throw new ReleaseError(422, "GitHub response is too large. Choose a smaller release range.");
  }
  if (!response.body) throw new ReleaseError(502, "GitHub returned no data.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GITHUB_BYTES) throw new ReleaseError(422, "GitHub response is too large. Choose a smaller release range.");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fixed origin, no credentials, redirects, retries, arbitrary URLs, or repository execution. */
export async function collectRelease(rawInput: ReleaseInput, fetcher: typeof fetch = fetch, parentSignal?: AbortSignal): Promise<ReleaseCollection> {
  const input = parseReleaseInput(rawInput);
  const signal = AbortSignal.any([AbortSignal.timeout(GITHUB_DEADLINE_MS), ...(parentSignal ? [parentSignal] : [])]);
  let requests = 0;
  const root = `https://api.github.com/repos/${input.repository}`;
  async function get(path: string): Promise<unknown> {
    if (++requests > MAX_GITHUB_REQUESTS) throw new ReleaseError(422, "GitHub request budget exceeded.");
    try {
      const response = await fetcher(`${root}${path}`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        redirect: "error", cache: "no-store", signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 403 || response.status === 429) throw new ReleaseError(429, "GitHub public API limit reached. Try again later.");
        if (response.status === 404) throw new ReleaseError(404, "Public repository or ref not found.");
        if (response.status === 409 || response.status === 422) throw new ReleaseError(422, "GitHub cannot compare these refs. Check the repository and range.");
        throw new ReleaseError(502, "GitHub is temporarily unavailable.");
      }
      return await boundedJson(response);
    } catch (error) {
      if (error instanceof ReleaseError) throw error;
      throw new ReleaseError(signal.aborted ? 504 : 502, signal.aborted ? "GitHub collection timed out. Try a smaller range." : "Unable to read GitHub data.");
    }
  }

  const repo = record(await get(""));
  if (repo.private !== false || typeof repo.full_name !== "string" || repo.full_name.toLowerCase() !== input.repository.toLowerCase()) throw new ReleaseError(404, "Public repository not found.");
  // Resolve both moving refs first; every subsequent link and comparison is pinned.
  const baseSha = sha(record(await get(`/commits/${encodeURIComponent(input.base)}`)).sha);
  const headSha = sha(record(await get(`/commits/${encodeURIComponent(input.head)}`)).sha);
  const compare = record(await get(`/compare/${baseSha}...${headSha}?per_page=100&page=1`));
  if (!["ahead", "identical"].includes(String(compare.status))) throw new ReleaseError(422, "Head must descend from base. Choose an ancestor base ref.");
  if (!Array.isArray(compare.commits) || !Number.isSafeInteger(compare.total_commits) || Number(compare.total_commits) < 0) throw new ReleaseError(502, "GitHub returned an invalid comparison.");
  if (Number(compare.total_commits) > MAX_COMMITS) throw new ReleaseError(422, `This MVP supports up to ${MAX_COMMITS} commits. Choose a smaller range.`);
  if (compare.commits.length !== compare.total_commits) throw new ReleaseError(502, "GitHub returned an incomplete commit range.");
  const webRoot = `https://github.com/${input.repository}`;
  const warnings: string[] = [];
  const commits: CollectedCommit[] = compare.commits.map(value => {
    const item = record(value);
    const id = sha(item.sha);
    const message = record(item.commit).message;
    if (typeof message !== "string") throw new ReleaseError(502, "GitHub returned an invalid commit message.");
    if (message.length > 1200) warnings.push("Long commit messages were truncated to 1200 characters; review their full sources for omitted context.");
    return { sha: id, message: releaseText(message), reviewFlags: reviewFlags(message), evidence: [{ id: `commit:${id}`, kind: "commit" as const, label: id.slice(0, 7), url: `${webRoot}/commit/${id}` }], pullTitle: undefined as string | undefined };
  });
  if (new Set(commits.map(c => c.sha)).size !== commits.length) throw new ReleaseError(502, "GitHub returned duplicate commits.");
  for (const commit of commits.slice(0, MAX_PR_LOOKUPS)) {
    try {
      const pulls = await get(`/commits/${commit.sha}/pulls?per_page=10&page=1`);
      if (!Array.isArray(pulls)) throw new ReleaseError(502, "GitHub returned invalid pull requests.");
      if (pulls.length >= 10) warnings.push("Pull request associations may be incomplete for a commit.");
      // Only a merged PR whose merge commit is THIS commit is evidence for its title.
      for (const value of pulls.slice(0, 10)) {
        const pr = record(value);
        if (!pr.merged_at || pr.merge_commit_sha !== commit.sha || !Number.isSafeInteger(pr.number) || Number(pr.number) <= 0 || typeof pr.title !== "string") continue;
        const base = record(pr.base);
        const prRepo = record(base.repo);
        if (typeof prRepo.full_name !== "string" || prRepo.full_name.toLowerCase() !== input.repository.toLowerCase()) continue;
        commit.evidence.push({ id: `pr:${pr.number}`, kind: "pull_request", label: `PR #${pr.number}`, url: `${webRoot}/pull/${pr.number}` });
        if (pr.title.length > 300) warnings.push("Long pull request titles were truncated to 300 characters.");
        const prFlags = reviewFlags(pr.title);
        commit.reviewFlags = { securitySensitive: commit.reviewFlags!.securitySensitive || prFlags.securitySensitive, breakingChange: commit.reviewFlags!.breakingChange || prFlags.breakingChange };
        commit.pullTitle = releaseText(pr.title, 300);
        break;
      }
    } catch {
      warnings.push("Pull request enrichment stopped; commit evidence is still available.");
      break;
    }
  }
  if (commits.length > MAX_PR_LOOKUPS) warnings.push(`Pull request lookup is limited to the first ${MAX_PR_LOOKUPS} commits; remaining items use commit messages.`);
  const files: Evidence[] = [];
  if (!Array.isArray(compare.files)) warnings.push("Changed-file evidence was unavailable.");
  else {
    if (compare.files.length >= 300) warnings.push("GitHub limits comparison files to 300; the file list may be incomplete.");
    for (const value of compare.files.slice(0, 300)) {
      const file = record(value);
      if (typeof file.filename !== "string" || file.filename.length > 1000 || !file.filename || file.filename.split("/").some(p => p === "." || p === "..")) continue;
      if (releaseText(file.filename, 1000) !== file.filename) { warnings.push("An unsafe file path was omitted."); continue; }
      // Removed files exist at base. Files are range-level evidence, never attached to an arbitrary commit.
      const path = file.filename.split("/").map(encodeURIComponent).join("/");
      files.push({ id: `file:${file.filename}`, kind: "file", label: releaseText(file.filename, 1000), url: `${webRoot}/blob/${file.status === "removed" ? baseSha : headSha}/${path}` });
    }
  }
  return { repository: input.repository, baseSha, headSha, compareUrl: `${webRoot}/compare/${baseSha}...${headSha}`, commits, files, warnings: [...new Set(warnings)] };
}
