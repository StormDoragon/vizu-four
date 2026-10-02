import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeRelease, classifyChange, renderNotes, verifyEvidence } from "./analysis";
import { releaseFixture } from "./fixtures";
import { releaseText } from "./text";

afterEach(() => vi.unstubAllEnvs());
describe("deterministic classification", () => {
  it.each([
    ["feat(ui): add export", "added", true, "customer"],
    ["fix: repair sorting", "fixed", true, "customer"],
    ["perf: reduce allocations", "improved", true, "customer"],
    ["docs: explain setup", "documentation", true, "developer"],
    ["chore: update tooling", "internal", false, "internal"],
    ["ci: fix build", "internal", false, "internal"],
    ["test: add coverage", "internal", false, "internal"],
    ["build: use new bundler", "internal", false, "internal"],
    ["refactor: rename helpers", "internal", false, "internal"],
    ["style: format", "internal", false, "internal"],
    ["fix(ci): repair workflow", "internal", false, "internal"],
    ["feat(tooling): add linter", "internal", false, "internal"],
    ["Add CSV export", "added", true, "customer"],
    ["Fix sorting", "fixed", true, "customer"],
    ["Improve load time", "improved", true, "customer"],
    ["Bump dependencies", "internal", false, "internal"],
    ["Fix server DoS", "security", true, "unknown"],
    ["Add CI pipeline", "internal", false, "internal"],
    ["Merge branch main", "internal", false, "internal"],
    ["update stuff", "other", false, "unknown"],
    ["feat!: replace API", "breaking", true, "developer"],
    ["chore: retire API\n\nBREAKING CHANGE: removed endpoint", "breaking", true, "developer"],
    ["fix: CVE-2026-12345", "security", true, "unknown"],
    ["chore: fix security issue", "security", true, "unknown"],
  ])("classifies %s", (message, category, releaseWorthy, impact) => {
    const change = classifyChange(releaseFixture([message as string]).commits[0]);
    expect(change).toMatchObject({ category, releaseWorthy, impact });
    expect(change.evidence).toHaveLength(1);
  });
  it("keeps breaking and security flags together", () => expect(classifyChange(releaseFixture(["fix!: security policy update"]).commits[0])).toMatchObject({ breakingChange: true, securitySensitive: true, importance: "high" }));
  it("uses a collected PR title but retains commit-body breaking markers", () => {
    const commit = releaseFixture(["merge\nBREAKING CHANGE: API removed"]).commits[0];
    expect(classifyChange({ ...commit, pullTitle: "feat: add API" })).toMatchObject({ title: "feat: add API", breakingChange: true });
  });
  it("never lets a non-breaking PR title erase a breaking commit header", () => {
    const commit = releaseFixture(["feat!: remove old API"]).commits[0];
    expect(classifyChange({ ...commit, pullTitle: "feat: new API" }).breakingChange).toBe(true);
  });
  it("is repeatable and does not modify its input", () => {
    const input = releaseFixture(); const before = JSON.stringify(input);
    expect(analyzeRelease(input)).toEqual(analyzeRelease(input));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("evidence and exports", () => {
  const analysis = analyzeRelease(releaseFixture());
  const change = analysis.changes[0];
  it("accepts collected evidence only for its own change", () => {
    expect(verifyEvidence([change.evidence[0].id], change)).toBe(true);
    for (const ids of [[], ["pr:999"], [analysis.changes[1].evidence[0].id], [change.evidence[0].url], [change.evidence[0].id, change.evidence[0].id], null]) expect(verifyEvidence(ids, change)).toBe(false);
  });
  it("derives both outputs from one analysis and excludes maintenance", () => {
    const notes = renderNotes(analysis);
    expect(notes.technical).toContain("feat: add CSV export");
    expect(notes.customer).toContain("add CSV export");
    expect(notes.customer).not.toContain("feat:");
    for (const text of Object.values(notes)) { expect(text).not.toContain("refresh tooling"); expect(text).toContain(change.evidence[0].url); }
  });
  it("withholds sensitive descriptions from both exported audiences", () => {
    const notes = renderNotes(analyzeRelease(releaseFixture(["fix!: security bypass details"])));
    expect(notes.technical).toContain("maintainer review");
    expect(notes.technical).not.toContain("bypass details");
    expect(notes.customer).not.toContain("bypass details");
  });
  it("escapes injected Markdown and HTML", () => {
    const notes = renderNotes(analyzeRelease(releaseFixture(["feat: [click](javascript:evil) <script>bad</script>"])));
    expect(notes.technical).toContain("\\[click\\]\\(javascript:evil\\)");
    expect(notes.customer).not.toContain("<script>");
  });
  it("handles an empty comparison", () => expect(renderNotes(analyzeRelease(releaseFixture([]))).technical).toContain("No release-worthy changes"));
  it("masks known keys and token formats before truncation", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "private-secret-value");
    expect(releaseText("private-secret-value", 10)).toBe("***");
    expect(releaseText("ghp_" + "a".repeat(30))).toBe("[redacted]");
    expect(releaseText("hello\u202eevil")).toBe("helloevil");
  });
});
