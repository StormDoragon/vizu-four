import type { JsonValue } from "../workflow/types";

export type GhType = "null" | "boolean" | "number" | "string" | "object";

export function ghType(v: JsonValue | undefined): GhType {
  if (v === undefined || v === null) return "null";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  return "object"; // arrays and maps are both "object" for coercion purposes
}

/** Truthiness rules used by `if:`, `!`, and the operands of `&&`/`||`. */
export function toBoolean(v: JsonValue | undefined): boolean {
  switch (ghType(v)) {
    case "null":
      return false;
    case "boolean":
      return v as boolean;
    case "number":
      return v !== 0 && !Number.isNaN(v as number);
    case "string":
      return (v as string).length > 0;
    default:
      return true;
  }
}

/** Numeric coercion used for cross-type `==`/`!=` and all relational ops. */
export function toNumber(v: JsonValue | undefined): number {
  switch (ghType(v)) {
    case "number":
      return v as number;
    case "boolean":
      return v ? 1 : 0;
    case "null":
      return 0;
    case "string": {
      const s = (v as string).trim();
      if (s === "") return 0;
      return Number(s);
    }
    default:
      return NaN;
  }
}

/** String coercion used by string functions and final interpolation output. */
export function toDisplayString(v: JsonValue | undefined): string {
  switch (ghType(v)) {
    case "string":
      return v as string;
    case "number":
      return Object.is(v, -0) ? "0" : String(v);
    case "boolean":
      return v ? "true" : "false";
    case "null":
      return "";
    default:
      // GitHub's real behavior for bare object/array-to-string coercion is a
      // documented rough edge; JSON is the most useful approximation for a
      // debugger (prefer `toJSON()` explicitly for guaranteed fidelity).
      return JSON.stringify(v);
  }
}

/** `==` / `!=` per the documented type-coercion table (best-effort, see README). */
export function looseEquals(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  const ta = ghType(a);
  const tb = ghType(b);
  if (ta === tb) {
    switch (ta) {
      case "null":
        return true;
      case "boolean":
        return a === b;
      case "number":
        return a === b;
      case "string":
        return (a as string).toLowerCase() === (b as string).toLowerCase();
      default:
        return a === b;
    }
  }
  return toNumber(a) === toNumber(b);
}

export function compareRelational(
  op: "<" | "<=" | ">" | ">=",
  a: JsonValue | undefined,
  b: JsonValue | undefined
): boolean {
  let cmp: number;
  if (typeof a === "string" && typeof b === "string") {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    cmp = la < lb ? -1 : la > lb ? 1 : 0;
  } else {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return false;
    cmp = na < nb ? -1 : na > nb ? 1 : 0;
  }
  switch (op) {
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
  }
}

/** Case-insensitive property lookup, matching GH's case-insensitive context/property names. */
export function getProperty(obj: JsonValue | undefined, prop: string): JsonValue | null {
  if (obj === null || obj === undefined || typeof obj !== "object" || Array.isArray(obj)) {
    return null;
  }
  const record = obj as Record<string, JsonValue>;
  if (Object.prototype.hasOwnProperty.call(record, prop)) return record[prop] ?? null;
  const lower = prop.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) return record[key] ?? null;
  }
  return null;
}
