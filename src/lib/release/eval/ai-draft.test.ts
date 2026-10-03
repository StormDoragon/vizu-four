import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reviewFlags } from "../flags";
import { releaseText } from "../text";
import { evaluateCase, formatReport } from "./metrics";
import { importWorksheet, type Worksheet } from "./reviewed";
import type { EvalCase } from "./types";

const raw = readFileSync(new URL("../../../../labeling/AI-DRAFT-StormDoragon-vizu-four-eba1815-6dbf7b0.json", import.meta.url));
const worksheet: Worksheet = JSON.parse(raw.toString("utf8"));
const cases: EvalCase[] = worksheet.rows.map(row => ({
  id: `ai-draft:${row.sha}`, source: "ai-draft", message: releaseText(row.message),
  ...(row.pullTitle ? { pullTitle: releaseText(row.pullTitle, 300) } : {}),
  reviewFlags: reviewFlags(`${row.pullTitle ?? ""}\n${row.message}`),
  expected: { releaseWorthy: row.label.includeInNotes!, securitySensitive: row.label.securitySensitive!, breakingChange: row.label.breakingChange!, ...(row.label.category ? { category: row.label.category } : {}) },
}));

describe("AI draft development measurement (not human accuracy)", () => {
  it("pins the original decisions and keeps them out of the human importer", () => {
    expect(createHash("sha256").update(raw.toString("utf8").replace(/\r\n/g, "\n")).digest("hex")).toBe("9d30d170aae0ed86179f9da4292ce8d03e7865a8aadd1bf329161deae1b7c294");
    expect(cases).toHaveLength(40);
    expect(importWorksheet(worksheet).cases).toEqual([]);
    expect(worksheet.review).toEqual({ reviewer: null, reviewedAt: null, recordUrl: null });
    const provenance = JSON.parse(readFileSync(new URL("../../../../labeling/ai-label-draft-provenance.json", import.meta.url), "utf8"));
    const source = readFileSync(new URL("./worksheets/StormDoragon-vizu-four-eba1815-6dbf7b0.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe(provenance.sourceWorksheetSha256);
    expect(provenance.classifierRunForThisRange).toBe(true);
    expect(provenance.postLabelingUse.independentCalibrationEligible).toBe(false);
  });
  it("reports every disagreement without setting a reviewed baseline", () => {
    process.stdout.write(formatReport(cases.map(evaluateCase)) + "\n");
  });
  it("retains the development fixes for every draft-positive security and breaking case", () => {
    for (const result of cases.map(evaluateCase)) {
      expect(result.failures.filter(f => f === "security miss" || f === "breaking miss"), result.case.id).toEqual([]);
    }
  });
});
