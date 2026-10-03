import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reviewedViolations } from "./gate";
import { evaluateCase } from "./metrics";
import { importWorksheet, loadReviewedCases, type Worksheet, type WorksheetRow } from "./reviewed";

/**
 * FIXTURES ONLY. The reviewer, record link and SHAs below are invented for the tests, which is exactly why a
 * well-formed worksheet must never be read as evidence that a human reviewed anything.
 */
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40), D = "d".repeat(40);
const label = (over: Partial<WorksheetRow["label"]> = {}): WorksheetRow["label"] => ({ includeInNotes: true, securitySensitive: false, breakingChange: false, category: null, note: "", ...over });
const row = (sha: string, message: string, over: Partial<WorksheetRow> = {}): WorksheetRow => ({ sha, message, pullTitle: null, url: `https://github.com/example/project/commit/${sha}`, label: label(), skip: null, ...over });
const worksheet = (rows: WorksheetRow[], over: Partial<Worksheet> = {}): Worksheet => ({
  schema: 1, repository: "example/project", baseRef: "v1", headRef: "v2", baseSha: A, headSha: B, generatedAt: "2026-01-01T00:00:00Z", commitCount: rows.length,
  review: { reviewer: "test fixture", reviewedAt: "2026-01-02", recordUrl: "https://example.com/review/1" }, rows, ...over,
});

describe("importWorksheet", () => {
  it("turns a complete worksheet into maintainer-reviewed cases with provenance", () => {
    const result = importWorksheet(worksheet([
      row(C, "feat: add CSV export", { label: label({ category: "added" }) }),
      row(D, "chore: refresh tooling", { label: label({ includeInNotes: false }) }),
    ]));
    expect(result.problems).toEqual([]);
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0]).toMatchObject({
      id: `example/project@${C.slice(0, 7)}`, source: "maintainer-reviewed", message: "feat: add CSV export",
      expected: { releaseWorthy: true, securitySensitive: false, breakingChange: false, category: "added" },
      provenance: { repository: "example/project", baseSha: A, headSha: B, reviewer: "test fixture", recordUrl: "https://example.com/review/1" },
    });
    expect(result.cases[1].expected).toEqual({ releaseWorthy: false, securitySensitive: false, breakingChange: false });
  });
  it("mirrors collection: masks and truncates the text, but flags come from the RAW message and PR title", () => {
    const long = `fix: tidy\r${"x".repeat(1500)}\rBREAKING CHANGE: replace the format`;
    const result = importWorksheet(worksheet([row(C, long, { pullTitle: "fix: patch an authentication bypass" })]));
    expect(result.problems).toEqual([]);
    const [c] = result.cases;
    expect(c.message.length).toBeLessThanOrEqual(1200);
    expect(c.message).not.toContain("BREAKING CHANGE");
    expect(c.pullTitle).toBe("fix: patch an authentication bypass");
    expect(c.reviewFlags).toEqual({ securitySensitive: true, breakingChange: true });
    expect(evaluateCase(c).actual).toMatchObject({ securitySensitive: true, breakingChange: true });
  });
  it("accepts skipped rows only with a reason, and reports them", () => {
    const ok = importWorksheet(worksheet([row(C, "feat: x"), row(D, "Merge branch main", { label: label({ includeInNotes: null, securitySensitive: null, breakingChange: null }), skip: { reason: "Pure merge commit; nothing to judge." } })]));
    expect(ok.problems).toEqual([]);
    expect(ok.cases).toHaveLength(1);
    expect(ok.skipped).toEqual([{ sha: D, reason: "Pure merge commit; nothing to judge." }]);
    const bad = importWorksheet(worksheet([row(C, "feat: x", { skip: { reason: "meh" } })]));
    expect(bad.problems.join()).toContain("skip needs a reason");
    expect(bad.cases).toEqual([]);
  });
  it.each([
    ["an unlabeled includeInNotes", row(C, "feat: x", { label: label({ includeInNotes: null }) }), "includeInNotes must be true or false"],
    ["an unlabeled securitySensitive", row(C, "feat: x", { label: label({ securitySensitive: null }) }), "securitySensitive must be true or false"],
    ["an unlabeled breakingChange", row(C, "feat: x", { label: label({ breakingChange: null }) }), "breakingChange must be true or false"],
    ["an unknown category", row(C, "feat: x", { label: label({ category: "feature" as never }) }), "category must be null or one of"],
    ["a short sha", row("abc123", "feat: x"), "40-character commit SHA"],
  ])("rejects %s and imports nothing", (_name, bad, message) => {
    const result = importWorksheet(worksheet([bad]));
    expect(result.problems.join()).toContain(message);
    expect(result.cases).toEqual([]);
  });
  it("rejects a worksheet that is not fully labeled even if other rows are fine (no cherry-picking)", () => {
    const result = importWorksheet(worksheet([row(C, "feat: x"), row(D, "fix: y", { label: label({ includeInNotes: null }) })]));
    expect(result.cases).toEqual([]);
    expect(result.problems).toHaveLength(1);
  });
  it("requires every commit in the range to appear", () => {
    expect(importWorksheet(worksheet([row(C, "feat: x")], { commitCount: 3 })).problems.join()).toContain("every commit in the range must appear");
  });
  it("rejects duplicate commits", () => {
    expect(importWorksheet(worksheet([row(C, "feat: x"), row(C, "feat: y")])).problems.join()).toContain("duplicate sha");
  });
  it.each([
    ["no reviewer", { reviewer: null, reviewedAt: "2026-01-02", recordUrl: "https://example.com/r" }, "reviewer is not filled in"],
    ["a blank reviewer", { reviewer: "  ", reviewedAt: "2026-01-02", recordUrl: "https://example.com/r" }, "reviewer is not filled in"],
    ["no date", { reviewer: "x", reviewedAt: null, recordUrl: "https://example.com/r" }, "reviewedAt"],
    ["no record link", { reviewer: "x", reviewedAt: "2026-01-02", recordUrl: null }, "recordUrl"],
    ["an http record link", { reviewer: "x", reviewedAt: "2026-01-02", recordUrl: "http://example.com/r" }, "recordUrl"],
  ])("rejects a worksheet with %s (a blank worksheet is never review data)", (_name, review, message) => {
    const result = importWorksheet(worksheet([row(C, "feat: x")], { review }));
    expect(result.problems.join()).toContain(message);
    expect(result.cases).toEqual([]);
  });
  it("rejects a freshly generated worksheet, which has no labels and no review block", () => {
    const blank = worksheet([row(C, "feat: x", { label: label({ includeInNotes: null, securitySensitive: null, breakingChange: null }) })], { review: { reviewer: null, reviewedAt: null, recordUrl: null } });
    expect(importWorksheet(blank).cases).toEqual([]);
    expect(importWorksheet(blank).problems.length).toBeGreaterThan(0);
  });
  it("rejects malformed input", () => {
    for (const raw of [null, [], "x", 3, {}, { schema: 2 }]) expect(importWorksheet(raw).cases, JSON.stringify(raw)).toEqual([]);
    expect(importWorksheet(null).problems).toEqual(["worksheet: not a JSON object"]);
  });
});

describe("reviewed cases and the gate", () => {
  it("passes when the classifier agrees with the maintainer, and fails on a disagreement", () => {
    const agree = importWorksheet(worksheet([row(C, "feat: add CSV export", { label: label({ category: "added" }) })]));
    expect(reviewedViolations(agree.cases.map(evaluateCase))).toEqual([]);
    const disagree = importWorksheet(worksheet([row(C, "chore: refresh tooling", { label: label({ includeInNotes: true }) })]));
    expect(reviewedViolations(disagree.cases.map(evaluateCase))).toEqual([`example/project@${C.slice(0, 7)}: false exclusion`]);
  });
  it("fails on a security miss against the maintainer's label", () => {
    const missed = importWorksheet(worksheet([row(C, "feat: add CSV export", { label: label({ securitySensitive: true }) })]));
    expect(reviewedViolations(missed.cases.map(evaluateCase))).toEqual([`example/project@${C.slice(0, 7)}: security miss`]);
  });
});

describe("loadReviewedCases", () => {
  const dirs: string[] = [];
  const temp = () => { const dir = mkdtempSync(join(tmpdir(), "vizu-reviewed-")); dirs.push(dir); return dir; };
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it("treats a missing directory as no reviewed ranges yet", () => {
    expect(loadReviewedCases(join(tmpdir(), "vizu-does-not-exist-" + Date.now()))).toEqual({ cases: [], skipped: [], problems: [] });
  });
  it("reports a directory that cannot be read instead of treating it as empty (ENOTDIR)", () => {
    const dir = temp();
    const notADirectory = join(dir, "reviewed");
    writeFileSync(notADirectory, "this is a file, not a directory");
    const result = loadReviewedCases(notADirectory);
    expect(result.problems).toEqual(["reviewed directory could not be read: ENOTDIR"]);
    expect(result.cases).toEqual([]);
  });
  it("reports a worksheet that cannot be read, by name (EISDIR), and keeps the readable ones", () => {
    const dir = temp();
    writeFileSync(join(dir, "good.json"), JSON.stringify(worksheet([row(C, "feat: x")])));
    mkdirSync(join(dir, "unreadable.json"));
    const result = loadReviewedCases(dir);
    expect(result.problems).toEqual(["unreadable.json: could not be read (EISDIR)"]);
    expect(result.cases).toHaveLength(1);
  });
  it("only ENOENT means no reviewed ranges: a missing directory reports nothing", () => {
    expect(loadReviewedCases(join(temp(), "missing"))).toEqual({ cases: [], skipped: [], problems: [] });
  });
  it("loads every json worksheet, ignores other files, and reports bad ones by name", () => {
    const dir = temp();
    writeFileSync(join(dir, "good.json"), JSON.stringify(worksheet([row(C, "feat: x")])));
    writeFileSync(join(dir, "broken.json"), "{ not json");
    writeFileSync(join(dir, "blank.json"), JSON.stringify(worksheet([row(D, "feat: y", { label: label({ includeInNotes: null }) })])));
    writeFileSync(join(dir, "README.md"), "# not a worksheet");
    mkdirSync(join(dir, "nested"));
    const result = loadReviewedCases(dir);
    expect(result.cases).toHaveLength(1);
    expect(result.problems.some(p => p.startsWith("broken.json: invalid JSON"))).toBe(true);
    expect(result.problems.some(p => p.startsWith("blank.json:"))).toBe(true);
  });
});

describe("committed draft worksheets", () => {
  const dir = fileURLToPath(new URL("./worksheets", import.meta.url));
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".json")) : [];

  it.each(files)("%s is a well-formed worksheet and its rows are complete", file => {
    const w = JSON.parse(readFileSync(join(dir, file), "utf8")) as Worksheet;
    expect(w.schema).toBe(1);
    expect(w.repository).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(w.baseSha).toMatch(/^[0-9a-f]{40}$/); expect(w.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(w.commitCount).toBe(w.rows.length);
    expect(new Set(w.rows.map(r => r.sha)).size).toBe(w.rows.length);
    for (const r of w.rows) { expect(r.sha).toMatch(/^[0-9a-f]{40}$/); expect(typeof r.message).toBe("string"); expect(r.url).toBe(`https://github.com/${w.repository}/commit/${r.sha}`); }
  });
  it("keeps hold-out ranges disjoint from calibration ranges, across drafts and reviewed worksheets", () => {
    const reviewedDir = fileURLToPath(new URL("./reviewed", import.meta.url));
    const all = [
      ...files.map(f => JSON.parse(readFileSync(join(dir, f), "utf8")) as Worksheet),
      ...(existsSync(reviewedDir) ? readdirSync(reviewedDir).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(join(reviewedDir, f), "utf8")) as Worksheet) : []),
    ];
    const shas = (role: "holdout" | "calibration") => new Set(all.filter(w => (w.role ?? "calibration") === role).flatMap(w => w.rows.map(r => `${w.repository}@${r.sha}`)));
    const holdout = shas("holdout"), calibration = shas("calibration");
    expect([...holdout].filter(sha => calibration.has(sha)), "a commit in a hold-out range must never also be in a calibration range").toEqual([]);
  });
  it("draft worksheets are never loaded as reviewed data", () => {
    // worksheets/ is not what the corpus loads; only reviewed/ is.
    const loaded = loadReviewedCases(fileURLToPath(new URL("./reviewed", import.meta.url)));
    for (const file of files) expect(loaded.cases.some(c => c.id.includes(file)), file).toBe(false);
  });
  it("a draft with blank labels cannot be imported as review data", () => {
    for (const file of files) {
      const w = JSON.parse(readFileSync(join(dir, file), "utf8")) as Worksheet;
      if (w.review.reviewer === null) expect(importWorksheet(w, file).cases, file).toEqual([]);
    }
  });
});
