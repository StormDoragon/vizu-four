import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewFlags } from "../flags";
import { releaseText } from "../text";
import type { ReleaseChange } from "../types";
import type { EvalCase, Provenance } from "./types";

/**
 * Real release ranges labeled by a maintainer.
 *
 * Flow: `scripts/release-eval-worksheet.mjs` writes a worksheet with every label blank. A maintainer fills it
 * in and the review block, then it is committed under `reviewed/`. `importWorksheet` turns it into
 * `maintainer-reviewed` cases. NOTHING here can verify that a human did the review: the checks below prove a
 * worksheet is complete and well-formed, not that it is honest. Provenance is a pointer to follow.
 */

export const ROLES = ["calibration", "holdout"] as const;
export type Role = (typeof ROLES)[number];

/** GitHub repository names are case-insensitive, so commit identity must be too: `StormDoragon/x` and `stormdoragon/x` are one repository. */
export const commitKey = (repository: string, sha: string) => `${repository.toLowerCase()}@${sha.toLowerCase()}`;

export const CATEGORIES: ReleaseChange["category"][] = ["added", "fixed", "improved", "documentation", "security", "breaking", "internal", "other"];

export interface WorksheetLabel {
  /** Should a maintainer want this change in release notes? (null = not yet labeled) */
  includeInNotes: boolean | null;
  securitySensitive: boolean | null;
  breakingChange: boolean | null;
  /** Optional. Omit (null) when the category does not matter; inclusion is still scored. */
  category: ReleaseChange["category"] | null;
  note: string;
}

export interface WorksheetRow {
  sha: string;
  /** Raw commit message, exactly as GitHub returned it. */
  message: string;
  /** Title of the merged PR whose merge commit is this commit, when found. */
  pullTitle: string | null;
  url: string;
  label: WorksheetLabel;
  /** A row the maintainer cannot judge. Skips are reported, never silent. */
  skip: { reason: string } | null;
}

export interface Worksheet {
  schema: 1;
  /** What the range is for. A "holdout" is labeled after rule changes and never used to tune rules. Absent means calibration. */
  role?: Role;
  repository: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  generatedAt: string;
  /** Where the raw data came from. "local-git" worksheets have no merged-PR titles. */
  collectedFrom?: "github-api" | "local-git";
  commitCount: number;
  review: { reviewer: string | null; reviewedAt: string | null; recordUrl: string | null };
  rows: WorksheetRow[];
}

export interface ImportResult {
  cases: EvalCase[];
  skipped: { sha: string; reason: string }[];
  problems: string[];
}

const SHA = /^[0-9a-f]{40}$/;

export function importWorksheet(raw: unknown, origin = "worksheet"): ImportResult {
  const problems: string[] = [];
  const fail = (message: string) => { problems.push(`${origin}: ${message}`); };
  const empty: ImportResult = { cases: [], skipped: [], problems };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { fail("not a JSON object"); return empty; }
  const w = raw as Partial<Worksheet>;
  if (w.schema !== 1) fail("unsupported schema (expected 1)");
  if (w.role !== undefined && !ROLES.includes(w.role as Role)) fail(`role must be absent, "calibration" or "holdout" (got ${JSON.stringify(w.role)})`);
  if (typeof w.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(w.repository)) fail("repository must be owner/name");
  if (typeof w.baseSha !== "string" || !SHA.test(w.baseSha) || typeof w.headSha !== "string" || !SHA.test(w.headSha)) fail("baseSha and headSha must be 40-character commit SHAs");
  const review = w.review;
  if (!review || typeof review !== "object") fail("missing review block");
  else {
    if (typeof review.reviewer !== "string" || !review.reviewer.trim()) fail("review.reviewer is not filled in");
    if (typeof review.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(review.reviewedAt)) fail("review.reviewedAt must start with YYYY-MM-DD");
    if (typeof review.recordUrl !== "string" || !/^https:\/\//.test(review.recordUrl)) fail("review.recordUrl must be an https link to the record of the review");
  }
  if (!Array.isArray(w.rows) || w.rows.length === 0) { fail("no rows"); return empty; }
  if (w.commitCount !== w.rows.length) fail(`commitCount ${String(w.commitCount)} does not match ${w.rows.length} rows: every commit in the range must appear`);
  if (problems.length) return empty;

  const provenance: Provenance = { repository: w.repository!, baseSha: w.baseSha!, headSha: w.headSha!, reviewer: review!.reviewer!, reviewedAt: review!.reviewedAt!, recordUrl: review!.recordUrl! };
  const seen = new Set<string>();
  const cases: EvalCase[] = [];
  const skipped: { sha: string; reason: string }[] = [];
  for (const [i, row] of w.rows.entries()) {
    const where = `row ${i + 1}`;
    if (!row || typeof row !== "object") { fail(`${where}: not an object`); continue; }
    if (typeof row.sha !== "string" || !SHA.test(row.sha)) { fail(`${where}: sha must be a 40-character commit SHA`); continue; }
    if (seen.has(row.sha)) { fail(`${where}: duplicate sha ${row.sha}`); continue; }
    seen.add(row.sha);
    if (typeof row.message !== "string") { fail(`${where} (${row.sha.slice(0, 7)}): message must be a string`); continue; }
    if (row.skip) {
      if (typeof row.skip.reason !== "string" || row.skip.reason.trim().length < 10) fail(`${where} (${row.sha.slice(0, 7)}): a skip needs a reason of at least 10 characters`);
      else skipped.push({ sha: row.sha, reason: row.skip.reason });
      continue;
    }
    const l = row.label;
    const id = `${row.sha.slice(0, 7)}`;
    if (!l || typeof l.includeInNotes !== "boolean") fail(`${where} (${id}): label.includeInNotes must be true or false`);
    else if (typeof l.securitySensitive !== "boolean") fail(`${where} (${id}): label.securitySensitive must be true or false`);
    else if (typeof l.breakingChange !== "boolean") fail(`${where} (${id}): label.breakingChange must be true or false`);
    else if (l.category !== null && !CATEGORIES.includes(l.category as ReleaseChange["category"])) fail(`${where} (${id}): label.category must be null or one of ${CATEGORIES.join(", ")}`);
    else {
      // Mirror collection: text is masked and truncated, but flags come from the RAW message and PR title, OR-merged.
      const message = releaseText(row.message);
      const commitFlags = reviewFlags(row.message);
      const prFlags = row.pullTitle ? reviewFlags(row.pullTitle) : { securitySensitive: false, breakingChange: false };
      cases.push({
        id: `${w.repository!.toLowerCase()}@${id}`,
        source: "maintainer-reviewed",
        message,
        ...(row.pullTitle ? { pullTitle: releaseText(row.pullTitle, 300) } : {}),
        reviewFlags: { securitySensitive: commitFlags.securitySensitive || prFlags.securitySensitive, breakingChange: commitFlags.breakingChange || prFlags.breakingChange },
        expected: { releaseWorthy: l.includeInNotes, securitySensitive: l.securitySensitive, breakingChange: l.breakingChange, ...(l.category ? { category: l.category } : {}) },
        ...(l.note ? { note: l.note } : {}),
        provenance,
      });
    }
  }
  return problems.length ? { cases: [], skipped: [], problems } : { cases, skipped, problems };
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code ?? "unknown error";

/**
 * Role problems across a set of worksheets: an unknown role (which would otherwise drop out of any partition and
 * escape the overlap check), or a commit that is in both a hold-out and a calibration range. Commits are compared
 * case-insensitively by repository. An absent role means calibration.
 */
export function roleProblems(worksheets: { name: string; worksheet: unknown }[]): string[] {
  const problems: string[] = [];
  const seen: Record<Role, Map<string, string>> = { calibration: new Map(), holdout: new Map() };
  for (const { name, worksheet } of worksheets) {
    const w = worksheet as Partial<Worksheet> | null;
    if (!w || typeof w !== "object" || typeof w.repository !== "string" || !Array.isArray(w.rows)) { problems.push(`${name}: not a worksheet`); continue; }
    if (w.role !== undefined && !ROLES.includes(w.role as Role)) { problems.push(`${name}: unknown role ${JSON.stringify(w.role)} (expected "calibration" or "holdout")`); continue; }
    const role: Role = w.role ?? "calibration";
    for (const row of w.rows) if (row && typeof row.sha === "string") seen[role].set(commitKey(w.repository, row.sha), name);
  }
  for (const [key, holdoutFile] of seen.holdout) {
    const calibrationFile = seen.calibration.get(key);
    if (calibrationFile) problems.push(`commit ${key} is in hold-out ${holdoutFile} and calibration ${calibrationFile}`);
  }
  return problems;
}

/**
 * Loads every `*.json` worksheet in `dir`. Only a directory that does not exist (ENOENT) means "no reviewed
 * ranges yet". Any other failure (ENOTDIR, EACCES, an unreadable file, ...) is reported as a problem, because
 * swallowing it would silently remove reviewed cases and let the gate pass.
 */
export function loadReviewedCases(dir: string): ImportResult {
  const all: ImportResult = { cases: [], skipped: [], problems: [] };
  let files: string[];
  try { files = readdirSync(dir).filter(f => f.endsWith(".json")).sort(); } catch (error) {
    if (errorCode(error) !== "ENOENT") all.problems.push(`reviewed directory could not be read: ${errorCode(error)}`);
    return all;
  }
  const parsedFiles: { name: string; worksheet: unknown }[] = [];
  const firstSeen = new Map<string, string>();
  for (const file of files) {
    let text: string;
    try { text = readFileSync(join(dir, file), "utf8"); } catch (error) { all.problems.push(`${file}: could not be read (${errorCode(error)})`); continue; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { all.problems.push(`${file}: invalid JSON`); continue; }
    parsedFiles.push({ name: file, worksheet: parsed });
    const w = parsed as Partial<Worksheet>;
    if (typeof w?.repository === "string" && Array.isArray(w.rows)) {
      for (const row of w.rows) {
        if (!row || typeof row.sha !== "string") continue;
        const key = commitKey(w.repository, row.sha);
        const other = firstSeen.get(key);
        if (other) all.problems.push(`${file}: commit ${key} is already in ${other}`);
        else firstSeen.set(key, file);
      }
    }
    const result = importWorksheet(parsed, file);
    all.cases.push(...result.cases); all.skipped.push(...result.skipped); all.problems.push(...result.problems);
  }
  all.problems.push(...roleProblems(parsedFiles));
  return all;
}
