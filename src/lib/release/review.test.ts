import { describe, expect, it } from "vitest";
import { analyzeRelease, renderNotes } from "./analysis";
import { releaseFixture } from "./fixtures";
import { applyReleaseEdits } from "./review";

describe("local release review", () => {
  it("changes inclusion and wording without mutating the source or its evidence", () => {
    const source = analyzeRelease(releaseFixture(["feat: add export", "miscellaneous change"]));
    const before = structuredClone(source);
    const [first, second] = source.changes;
    const edited = applyReleaseEdits(source, { [first.id]: { included: false }, [second.id]: { included: true, technical: "Added a documented option", customer: "Choose your export format" } });
    const notes = renderNotes(edited);
    expect(notes.customer).not.toContain("add export");
    expect(notes.customer).toContain("Choose your export format");
    expect(notes.technical).toContain("Added a documented option");
    expect(edited.changes[1].evidence).toEqual(second.evidence);
    expect(source).toEqual(before);
    expect(applyReleaseEdits(source, {})).toEqual(source);
  });
  it("cannot remove source security or breaking flags through edits", () => {
    const source = analyzeRelease(releaseFixture(["fix!: security bypass details"]));
    const edited = applyReleaseEdits(source, { [source.changes[0].id]: { included: true, technical: "Pretend harmless", customer: "Pretend harmless" } });
    expect(edited.changes[0]).toMatchObject({ securitySensitive: true, breakingChange: true });
    const notes = renderNotes(edited);
    for (const text of Object.values(notes)) {
      expect(text).not.toContain("bypass details");
      expect(text).not.toContain("Pretend harmless");
    }
  });
  it("withholds newly security-sensitive wording and escapes manual Markdown", () => {
    const source = analyzeRelease(releaseFixture(["feat: export"]));
    const id = source.changes[0].id;
    const sensitive = applyReleaseEdits(source, { [id]: { customer: "Fix a secret leak in logs" } });
    expect(sensitive.changes[0].securitySensitive).toBe(true);
    expect(renderNotes(sensitive).customer).not.toContain("secret leak");
    const ordinary = applyReleaseEdits(source, { [id]: { customer: "[click](javascript:alert(1))" } });
    expect(renderNotes(ordinary).customer).toContain("\\[click\\]");
  });
});
