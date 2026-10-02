import type { CollectedCommit, ReleaseAnalysis, ReleaseChange, ReleaseCollection } from "./types";
import { markdownText } from "./text";

/** Conventional Commits markers, plus explicit prose markers. Bare "breaking" is not a marker: "avoid breaking the layout" is a fix. */
const BREAKING = /(?:^|\n)(?:\w+(?:\([^\n)]*\))?!:\s*\S|BREAKING[ -]CHANGE:\s*\S|BREAKING:\s*\S)|[(\[]\s*breaking(?: changes?)?\s*[)\]]|\b(?:backwards?|backward)[- ]incompatible\b|\bnot (?:backwards?|backward)[- ]compatible\b/i;
/** Legacy keywords, plus unambiguous vulnerability classes and secret exposure (a leak/exposure verb near a secret noun, either order). */
const SECRET = "(?:secrets?|api[ -]?keys?|passwords?|credentials?|private keys?|(?:session|auth\\w*|access|refresh|api|bearer|personal access) tokens?)";
const SECURITY = new RegExp(
  "\\b(security|vulnerabilit\\w*|CVE-\\d{4}-\\d+|credential|exploit|injection|XSS|CSRF|DoS|RCE|denial of service|path traversal|auth(?:entication)? bypass)\\b"
  + "|\\b(?:SSRF|XXE|clickjacking|open redirect|privilege escalation|directory traversal|remote code execution|arbitrary code execution|sanitiz\\w*)\\b"
  + `|\\b(?:leak\\w*|expos\\w*|disclos\\w*)\\b[^\\n]{0,40}\\b${SECRET}\\b`
  + `|\\b${SECRET}\\b[^\\n]{0,40}\\b(?:leak\\w*|exposed|disclosed)\\b`, "i");

export function reviewFlags(text: string) {
  return {
    breakingChange: BREAKING.test(text),
    securitySensitive: SECURITY.test(text),
  };
}

export function classifyChange(commit: CollectedCommit): ReleaseChange {
  const text = `${commit.pullTitle ?? ""}\n${commit.message}`;
  const title = (commit.pullTitle || commit.message.split("\n")[0] || "Untitled change").slice(0, 300);
  const conventional = /^(\w+)(?:\(([^\n)]*)\))?(!)?:\s*(.+)/.exec(title);
  const type = conventional?.[1].toLowerCase();
  const scope = conventional?.[2]?.toLowerCase();
  const flags = reviewFlags(text);
  const breakingChange = flags.breakingChange || commit.reviewFlags?.breakingChange === true;
  const securitySensitive = flags.securitySensitive || commit.reviewFlags?.securitySensitive === true;
  const internal = ["chore", "ci", "build", "test", "refactor", "style"].includes(type ?? "")
    || ["ci", "build", "test", "tests", "deps-dev", "tooling"].includes(scope ?? "")
    || /^(?:Merge|Refactor|Bump)\b/i.test(title)
    || /^(?:Add|Fix|Improve|Update|Run) (?:CI|tests?|build|tooling)\b/i.test(title);
  let category: ReleaseChange["category"] = "other";
  if (securitySensitive) category = "security";
  else if (breakingChange) category = "breaking";
  else if (internal) category = "internal";
  else if (type === "feat" || /^(?:Add|Introduce)\b/i.test(title)) category = "added";
  else if (type === "fix" || /^(?:Fix|Repair|Resolve)\b/i.test(title)) category = "fixed";
  else if (type === "perf" || /^(?:Improve|Optimize)\b/i.test(title)) category = "improved";
  else if (type === "docs") category = "documentation";
  const impact: ReleaseChange["impact"] = category === "internal" ? "internal" : category === "documentation" || breakingChange ? "developer" : ["added", "fixed", "improved"].includes(category) ? "customer" : "unknown";
  const releaseWorthy = category !== "internal" && category !== "other";
  const reason = securitySensitive ? "Security-related metadata requires human review; customer output is withheld." : breakingChange ? "Explicit breaking-change marker; review migration requirements." : category === "internal" ? "Maintenance or merge metadata; excluded from release notes." : category === "other" ? "No clear release signal; review manually before including." : "Commit or merged PR title indicates a release change; impact is inferred from metadata.";
  const description = conventional?.[4] ?? title;
  return { id: commit.sha, title, category, impact, importance: breakingChange || securitySensitive ? "high" : releaseWorthy ? "medium" : "low", confidence: category === "other" || !conventional ? "low" : "medium", securitySensitive, breakingChange, releaseWorthy, reason, evidence: commit.evidence, technical: title, customer: description };
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
