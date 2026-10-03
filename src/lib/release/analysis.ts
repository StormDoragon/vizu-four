import type { CollectedCommit, ReleaseAnalysis, ReleaseChange, ReleaseCollection } from "./types";
import { markdownText } from "./text";

import { reviewFlags } from "./flags";
export { reviewFlags };

export function classifyChange(commit: CollectedCommit): ReleaseChange {
  const text = `${commit.pullTitle ?? ""}\n${commit.message}`;
  const title = (commit.pullTitle || commit.message.split("\n")[0] || "Untitled change").slice(0, 300);
  const normalizedTitle = title.replace(/^[^\p{L}\p{N}\[]+/u, "").replace(/^\[(?:feature|fix|bug|docs|perf)\]\s*/i, "").replace(/^[A-Z][A-Z0-9]+-\d+:\s*/, "");
  const signal = /^(?:cleanup|misc(?:ellaneous)?|update)\s*$/i.test(normalizedTitle)
    ? text.split("\n").find(line => /^(?:feat|fix|perf|docs)(?:\([^)]*\))?!?:/.test(line)) ?? normalizedTitle
    : normalizedTitle;
  const conventional = /^(\w+)(?:\(([^\n)]*)\))?(!)?:\s*(.+)/.exec(signal);
  const type = conventional?.[1].toLowerCase();
  const scope = conventional?.[2]?.toLowerCase();
  const flags = reviewFlags(text);
  const breakingChange = flags.breakingChange || commit.reviewFlags?.breakingChange === true;
  const securitySensitive = flags.securitySensitive || commit.reviewFlags?.securitySensitive === true;
  const internal = ["chore", "ci", "build", "test", "refactor", "style"].includes(type ?? "")
    || ["ci", "build", "test", "tests", "deps-dev", "tooling"].includes(scope ?? "")
    || /^(?:Merge|Refactor|Bump)\b/i.test(signal)
    || /^(?:Add|Fix(?:es|ed)?|Improve|Update|Run) (?:CI|tests?|build|tooling|eslint|lint|(?:failing|flaky) (?:CI|tests?))\b/i.test(signal)
    || /^(?:Fix(?:es|ed)? (?:typos?|merge conflicts)|Tidy up)\b/i.test(signal);
  let category: ReleaseChange["category"] = "other";
  if (securitySensitive) category = "security";
  else if (breakingChange) category = "breaking";
  else if (internal) category = "internal";
  else if (type === "docs" || /^(?:Update (?:README|documentation)|License)\b/i.test(signal)) category = "documentation";
  else if (type === "feat" || /^(?:Add|Introduce|Support|Implement|Allow)\b/i.test(signal)) category = "added";
  else if (type === "fix" || /^(?:Fix(?:es|ed)?|Repair|Resolve|Apply|Collapse|Compute|Keep|Report|Treat|Send|Only let|Put|Don't|Stop|Disable|Remove|Refuse)\b/i.test(signal)) category = "fixed";
  else if (type === "perf" || /^(?:Improve|Optimize|Speed up|Harden)\b/i.test(signal)) category = "improved";
  const impact: ReleaseChange["impact"] = category === "internal" ? "internal" : category === "documentation" || breakingChange ? "developer" : ["added", "fixed", "improved"].includes(category) ? "customer" : "unknown";
  const administrative = ["test", "ci", "build"].includes(type ?? "") || /^Merge\b/i.test(signal)
    || /^(?:Tidy up|docs: (?:status|restore README|record .*review|expand .*summary))\b/i.test(signal);
  const releaseWorthy = breakingChange || (!administrative && category !== "internal" && category !== "other");
  const reason = securitySensitive ? "Security-related metadata requires human review; customer output is withheld." : breakingChange ? "Explicit breaking-change marker; review migration requirements." : category === "internal" ? "Maintenance or merge metadata; excluded from release notes." : category === "other" ? "No clear release signal; review manually before including." : "Commit or merged PR title indicates a release change; impact is inferred from metadata.";
  const description = conventional?.[4] ?? title;
  return { id: commit.sha, title, category, impact, importance: breakingChange || securitySensitive ? "high" : releaseWorthy ? "medium" : "low", confidence: category === "other" || !conventional ? "low" : "medium", securitySensitive, breakingChange, releaseWorthy, reason, evidence: commit.evidence, technical: signal !== normalizedTitle ? signal.slice(0, 300) : title, customer: description };
}

export function analyzeRelease(collection: ReleaseCollection): ReleaseAnalysis {
  const { commits, ...rest } = collection;
  return { ...rest, source: "deterministic", changes: commits.map(classifyChange) };
}

/** Model citations must be exact IDs from this specific change, never URLs or unrelated evidence. */
export function verifyEvidence(ids: unknown, change: ReleaseChange): boolean {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= change.evidence.length && new Set(ids).size === ids.length && ids.every(id => typeof id === "string" && change.evidence.some(e => e.id === id));
}

export function renderNotes(analysis: ReleaseAnalysis): { technical: string; customer: string } {
  function render(audience: "technical" | "customer"): string {
    const changes = analysis.changes.filter(c => c.releaseWorthy && (audience === "technical" || !c.securitySensitive));
    const lines = [`# ${audience === "technical" ? "Technical release notes" : "Customer release notes"}`, "", `Repository: ${markdownText(analysis.repository)}`, "", `[Compared commits](${analysis.compareUrl})`, "", "Draft based on repository metadata. Review all claims before sharing.", ""];
    if (analysis.changes.some(c => c.securitySensitive)) lines.push("Security-sensitive changes require maintainer review; details are withheld from these notes.", "");
    if (!changes.length) lines.push("No release-worthy changes identified for this audience.");
    for (const change of changes) {
      const content = change.securitySensitive ? "Security-related change — maintainer review required." : change[audience];
      const sources = change.evidence.map(e => `[${markdownText(e.label)}](${e.url})`).join(" · ");
      lines.push(`- **${change.category}${change.breakingChange ? " / breaking" : ""}**: ${markdownText(content)} (${sources})`);
    }
    for (const warning of analysis.warnings) lines.push("", `> ${markdownText(warning)}`);
    return lines.join("\n");
  }
  return { technical: render("technical"), customer: render("customer") };
}
