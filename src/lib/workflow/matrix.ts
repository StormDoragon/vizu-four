import type { JsonValue, MatrixDefinition } from "./types";

export type MatrixCombo = Record<string, JsonValue>;

/**
 * GitHub's own ceiling: a matrix generates at most 256 jobs per workflow
 * run. Enforcing the same number keeps the debugger faithful and bounds an
 * expansion the workflow author controls - ten axes of ten values is ten
 * billion combinations from a few lines of YAML, and the product is built
 * synchronously on the process serving every visitor.
 */
export const MAX_MATRIX_COMBINATIONS = 256;

/**
 * Size of the cross product alone, derived from the axis lengths without
 * building anything - this is the part that grows exponentially and so the
 * part that has to be refused before it is allocated. Stops multiplying once
 * past the limit, so the returned number is exact only while it is within it.
 *
 * `include` is deliberately excluded. An include entry usually merges into
 * combos that already exist and adds no row at all, so counting one per entry
 * rejects legitimate matrices - a full 256-combination matrix plus a single
 * merging include counted as 257. Include entries also can't explode: there
 * is at most one per line of YAML. The real total is checked against
 * MAX_MATRIX_COMBINATIONS after expansion, which is safe once the product
 * below is known to be bounded.
 */
export function countBaseCombinations(def: MatrixDefinition): number {
  const axes = Object.values(def.axes);
  let product = axes.length === 0 ? 0 : 1;
  for (const values of axes) {
    product *= values.length;
    if (product > MAX_MATRIX_COMBINATIONS) return product;
  }
  return product;
}

function valuesEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a == b;
}

function cartesianProduct(axes: Record<string, JsonValue[]>): MatrixCombo[] {
  const keys = Object.keys(axes);
  if (keys.length === 0) return [];
  let combos: MatrixCombo[] = [{}];
  for (const key of keys) {
    const values = axes[key];
    const next: MatrixCombo[] = [];
    for (const combo of combos) {
      for (const value of values) {
        next.push({ ...combo, [key]: value });
      }
    }
    combos = next;
  }
  return combos;
}

/**
 * Expands a `strategy.matrix` definition into the concrete list of
 * combinations GitHub Actions would run, following the documented
 * include/exclude semantics:
 *
 *  1. Build the cross product of the plain axes.
 *  2. Apply `exclude` entries to it: any combo whose keys are all present
 *     and equal to an exclude entry's keys is dropped.
 *  3. Apply `include` entries in order, matched against what survived: an
 *     entry is merged into every remaining combo whose *original axis keys*
 *     it doesn't contradict; if it matches none, it becomes a new standalone
 *     combination. Include entries only ever match against that post-exclude
 *     snapshot, never against combos other include entries created, which is
 *     what allows two include entries sharing a key to produce two distinct
 *     rows rather than the second overwriting the first.
 *
 * The order matters and is the one GitHub documents - "all include
 * combinations are processed after exclude" - because it is what lets an
 * include add back a combination exclude removed. Running include first
 * instead made `exclude: [os: X]` followed by `include: [os: X]` produce
 * nothing, where GitHub produces one row.
 */
export function expandMatrix(def: MatrixDefinition | undefined): MatrixCombo[] {
  if (!def) return [];
  // Callers are expected to have rejected an oversized matrix before getting
  // here (createSession does, so a session can never hold one) - this is the
  // backstop that keeps any future caller from allocating the product.
  if (countBaseCombinations(def) > MAX_MATRIX_COMBINATIONS) {
    throw new Error(`Matrix produces more than ${MAX_MATRIX_COMBINATIONS} combinations`);
  }
  const originalKeys = new Set(Object.keys(def.axes));

  const base = cartesianProduct(def.axes);
  // Pristine snapshot used ONLY to decide which combos an include entry
  // matches: what the cross product left after exclusion. Include entries
  // never match combos created by other include entries, which is what
  // allows two include entries sharing a key to produce two distinct rows
  // instead of the second silently overwriting the first (see the
  // include-only test). An entry matching nothing here - because exclude
  // removed what it would have matched - is added back as its own row.
  const afterExclude =
    (def.exclude ?? []).length === 0
      ? base
      : base.filter(
          (combo) =>
            !(def.exclude ?? []).some((excludeEntry) => {
              const keys = Object.keys(excludeEntry);
              if (keys.length === 0) return false;
              return keys.every(
                (k) => k in combo && valuesEqual(combo[k], excludeEntry[k])
              );
            })
        );
  const combos: MatrixCombo[] = afterExclude.map((c) => ({ ...c }));

  for (const includeEntry of def.include ?? []) {
    const relevantKeys = Object.keys(includeEntry).filter((k) =>
      originalKeys.has(k)
    );
    const matchIndexes = afterExclude.reduce<number[]>((acc, combo, i) => {
      if (relevantKeys.every((k) => valuesEqual(combo[k], includeEntry[k]))) {
        acc.push(i);
      }
      return acc;
    }, []);
    if (matchIndexes.length > 0) {
      for (const i of matchIndexes) {
        Object.assign(combos[i], includeEntry);
      }
    } else {
      combos.push({ ...includeEntry });
    }
  }

  return dedupe(combos);
}

/**
 * Collapses combinations that are the same combination.
 *
 * `matrix: {a: [1, 1]}` expands to two identical combos, and an `include`
 * can produce a duplicate row the same way. A lane's identity is derived
 * from its combo's *content*, so two identical combos necessarily key the
 * same lane: the second overwrote the first in the lane map while
 * `laneOrder` still listed both, leaving two entries driving one lane -
 * the same corruption a key collision caused.
 *
 * Deduplicating rather than disambiguating, because content-addressed lane
 * identity is what share links rely on to find a lane again, and because two
 * identical combos have identical `matrix` contexts and would run
 * identically anyway. GitHub does not document this case; a repeated axis
 * value is an authoring mistake either way, and one lane is the reading that
 * keeps everything downstream consistent.
 */
function dedupe(combos: MatrixCombo[]): MatrixCombo[] {
  const seen = new Set<string>();
  return combos.filter((combo) => {
    const key = comboKey(combo);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Short, stable, human-readable label for a combo, e.g. `os=ubuntu-latest, node=18`. */
export function comboLabel(combo: MatrixCombo): string {
  const entries = Object.entries(combo);
  if (entries.length === 0) return "default";
  return entries.map(([k, v]) => `${k}=${stringifyValue(v)}`).join(", ");
}

/**
 * The structural characters of a combo key, plus the backslash that escapes
 * them and the `#` that marks a non-string value. Escaping all four is what
 * makes the encoding injective: after escaping, an unescaped `|`, `:` or
 * leading `#` can only be one this function put there.
 */
const KEY_RESERVED = /[\\|:#]/g;

function escapeKeyPart(s: string): string {
  return s.replace(KEY_RESERVED, (c) => `\\${c}`);
}

/**
 * Stable, collision-free key for a combo, used to build lane ids.
 *
 * Every part is escaped because a matrix value is workflow-author input and
 * may contain the delimiters. Naively joining let two genuinely different
 * combos produce one key - `{a: "x|b:y"}` and `{a: "x", b: "y"}` both gave
 * `a:x|b:y` - and since lanes are stored in a map keyed by this, the second
 * lane overwrote the first while `laneOrder` still listed both. One matrix
 * combination silently vanished and two entries drove the same lane.
 *
 * Non-string values are JSON-encoded behind a `#` marker, so the string
 * `"18"` and the number `18` stay distinct rather than both keying `a:18`.
 */
export function comboKey(combo: MatrixCombo): string {
  const entries = Object.entries(combo).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "default";
  return entries
    .map(([k, v]) => {
      const value =
        typeof v === "string" ? escapeKeyPart(v) : `#${escapeKeyPart(JSON.stringify(v))}`;
      return `${escapeKeyPart(k)}:${value}`;
    })
    .join("|");
}

function stringifyValue(v: JsonValue): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
