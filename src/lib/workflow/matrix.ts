import type { JsonValue, MatrixDefinition } from "./types";

export type MatrixCombo = Record<string, JsonValue>;

function valuesEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // eslint-disable-next-line eqeqeq
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
 *  2. Apply `include` entries in order: an entry is merged into every base
 *     combo whose *original axis keys* it doesn't contradict; if it matches
 *     none, it becomes a new standalone combination. Include entries only
 *     ever match against the original cross-product, never against other
 *     include-created standalone combos (this is what allows two separate
 *     include entries that share a key to produce two distinct rows rather
 *     than merging into each other).
 *  3. Apply `exclude` entries against the *resulting* list: any combo whose
 *     keys are all present and equal to an exclude entry's keys is dropped.
 */
export function expandMatrix(def: MatrixDefinition | undefined): MatrixCombo[] {
  if (!def) return [];
  const originalKeys = new Set(Object.keys(def.axes));
  // Pristine snapshot used ONLY to decide which combos an include entry
  // matches. Include entries never match combos created by other include
  // entries (only the original cross product), which is what allows two
  // include entries sharing a key to produce two distinct rows instead of
  // the second silently overwriting the first (see the include-only test).
  const originalBase = cartesianProduct(def.axes);
  const combos: MatrixCombo[] = originalBase.map((c) => ({ ...c }));

  for (const includeEntry of def.include ?? []) {
    const relevantKeys = Object.keys(includeEntry).filter((k) =>
      originalKeys.has(k)
    );
    const matchIndexes = originalBase.reduce<number[]>((acc, combo, i) => {
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

  const excluded = (def.exclude ?? []).length === 0
    ? combos
    : combos.filter((combo) => {
        return !(def.exclude ?? []).some((excludeEntry) => {
          const keys = Object.keys(excludeEntry);
          if (keys.length === 0) return false;
          return keys.every(
            (k) => k in combo && valuesEqual(combo[k], excludeEntry[k])
          );
        });
      });

  return excluded;
}

/** Short, stable, human-readable label for a combo, e.g. `os=ubuntu-latest, node=18`. */
export function comboLabel(combo: MatrixCombo): string {
  const entries = Object.entries(combo);
  if (entries.length === 0) return "default";
  return entries.map(([k, v]) => `${k}=${stringifyValue(v)}`).join(", ");
}

/** Stable hash-free key safe for use in ids/URLs. */
export function comboKey(combo: MatrixCombo): string {
  const entries = Object.entries(combo).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "default";
  return entries.map(([k, v]) => `${k}:${stringifyValue(v)}`).join("|");
}

function stringifyValue(v: JsonValue): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
