import { reviewFlags } from "./flags";
import type { ReleaseAnalysis } from "./types";

export interface ChangeEdit {
  included?: boolean;
  technical?: string;
  customer?: string;
}

/** Local draft edits never alter evidence or remove a source's review flags. */
export function applyReleaseEdits(analysis: ReleaseAnalysis, edits: Record<string, ChangeEdit>): ReleaseAnalysis {
  return { ...analysis, changes: analysis.changes.map(change => {
    const edit = edits[change.id];
    if (!edit) return change;
    const wording = (value: string | undefined, original: string) => value?.trim().slice(0, 600) || original;
    const technical = change.securitySensitive ? change.technical : wording(edit.technical, change.technical);
    const customer = change.securitySensitive ? change.customer : wording(edit.customer, change.customer);
    const flags = reviewFlags(`${technical}\n${customer}`);
    const securitySensitive = change.securitySensitive || flags.securitySensitive;
    const breakingChange = change.breakingChange || flags.breakingChange;
    return { ...change, technical, customer, securitySensitive, breakingChange,
      category: securitySensitive ? "security" : breakingChange ? "breaking" : change.category,
      releaseWorthy: edit.included ?? change.releaseWorthy };
  }) };
}
