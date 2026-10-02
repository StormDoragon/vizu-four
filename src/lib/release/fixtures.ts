import type { ReleaseCollection } from "./types";

/** Synthetic metadata for tests; never used as live evidence. */
export function releaseFixture(messages = ["feat: add CSV export", "chore: refresh tooling"]): ReleaseCollection {
  const repository = "example/project";
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  return { repository, baseSha, headSha, compareUrl: `https://github.com/${repository}/compare/${baseSha}...${headSha}`, files: [], warnings: [], commits: messages.map((message, i) => {
    const sha = (i + 1).toString(16).padStart(40, "0");
    return { sha, message, evidence: [{ id: `commit:${sha}`, kind: "commit", label: sha.slice(-7), url: `https://github.com/${repository}/commit/${sha}` }] };
  }) };
}
