import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { JsonValue } from "../workflow/types";
import { looseEquals, toDisplayString } from "./coerce";

export class ExpressionFunctionError extends Error {}

function requireArgs(name: string, args: JsonValue[], count: number) {
  if (args.length !== count) {
    throw new ExpressionFunctionError(
      `${name}() expects ${count} argument${count === 1 ? "" : "s"}, got ${args.length}`
    );
  }
}

function contains(args: JsonValue[]): boolean {
  requireArgs("contains", args, 2);
  const [haystack, needle] = args;
  if (Array.isArray(haystack)) {
    return haystack.some((el) => looseEquals(el, needle));
  }
  return toDisplayString(haystack).toLowerCase().includes(toDisplayString(needle).toLowerCase());
}

function startsWith(args: JsonValue[]): boolean {
  requireArgs("startsWith", args, 2);
  return toDisplayString(args[0]).toLowerCase().startsWith(toDisplayString(args[1]).toLowerCase());
}

function endsWith(args: JsonValue[]): boolean {
  requireArgs("endsWith", args, 2);
  return toDisplayString(args[0]).toLowerCase().endsWith(toDisplayString(args[1]).toLowerCase());
}

function format(args: JsonValue[]): string {
  if (args.length === 0) {
    throw new ExpressionFunctionError("format() expects at least 1 argument");
  }
  const [fmtValue, ...rest] = args;
  const fmt = toDisplayString(fmtValue);
  let out = "";
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === "{" && fmt[i + 1] === "{") {
      out += "{";
      i++;
      continue;
    }
    if (c === "}" && fmt[i + 1] === "}") {
      out += "}";
      i++;
      continue;
    }
    if (c === "{") {
      let j = i + 1;
      let numStr = "";
      while (j < fmt.length && /[0-9]/.test(fmt[j])) {
        numStr += fmt[j];
        j++;
      }
      if (numStr !== "" && fmt[j] === "}") {
        const idx = Number(numStr);
        if (idx >= rest.length) {
          throw new ExpressionFunctionError(
            `format() placeholder {${idx}} has no matching argument`
          );
        }
        out += toDisplayString(rest[idx]);
        i = j;
        continue;
      }
      throw new ExpressionFunctionError(`format() has an invalid placeholder at index ${i}`);
    }
    if (c === "}") {
      throw new ExpressionFunctionError(`format() has an unmatched '}' at index ${i}`);
    }
    out += c;
  }
  return out;
}

function join(args: JsonValue[]): string {
  if (args.length < 1 || args.length > 2) {
    throw new ExpressionFunctionError("join() expects 1 or 2 arguments");
  }
  const [value, sep] = args;
  const separator = sep === undefined ? "," : toDisplayString(sep);
  if (Array.isArray(value)) {
    return value.map((v) => toDisplayString(v)).join(separator);
  }
  return toDisplayString(value);
}

function toJSONFn(args: JsonValue[]): string {
  requireArgs("toJSON", args, 1);
  return JSON.stringify(args[0], null, 2);
}

function fromJSONFn(args: JsonValue[]): JsonValue {
  requireArgs("fromJSON", args, 1);
  const text = toDisplayString(args[0]);
  try {
    return JSON.parse(text);
  } catch {
    throw new ExpressionFunctionError(`fromJSON(): invalid JSON: ${truncate(text)}`);
  }
}

function truncate(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Real (best-effort) implementation: SHA-256 over the matched files' contents, sorted by path. */
function hashFiles(args: JsonValue[], cwd: string): string {
  if (args.length === 0) {
    throw new ExpressionFunctionError("hashFiles() expects at least 1 pattern");
  }
  const patterns = args.map((a) => toDisplayString(a));
  let files: string[];
  try {
    files = fg.sync(patterns, { cwd, dot: true, onlyFiles: true }).sort();
  } catch {
    return "";
  }
  if (files.length === 0) return "";
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(fs.readFileSync(path.join(cwd, file)));
  }
  return hash.digest("hex");
}

export interface StatusFlags {
  /** Any prior step in this job/job in this run failed (and wasn't continue-on-error). */
  anyFailure: boolean;
  cancelled: boolean;
}

export const STATUS_FUNCTIONS = new Set(["success", "failure", "cancelled", "always"]);

export function evalStatusFunction(name: string, status: StatusFlags): boolean {
  switch (name) {
    case "success":
      return !status.anyFailure && !status.cancelled;
    case "failure":
      return status.anyFailure;
    case "cancelled":
      return status.cancelled;
    case "always":
      return true;
    default:
      throw new ExpressionFunctionError(`Unknown status function ${name}()`);
  }
}

type PureFn = (args: JsonValue[]) => JsonValue;

const PURE_FUNCTIONS: Record<string, PureFn> = {
  contains,
  startswith: startsWith,
  endswith: endsWith,
  format,
  join,
  tojson: toJSONFn,
  fromjson: fromJSONFn,
};

/**
 * Resolves and invokes a built-in function by (case-insensitive) name.
 * `cwd` is the working directory used for `hashFiles()`; callers evaluating
 * expressions without filesystem context (e.g. the standalone playground)
 * can pass `process.cwd()` or any scratch directory.
 */
export function callBuiltin(name: string, args: JsonValue[], cwd: string): JsonValue {
  const lower = name.toLowerCase();
  if (lower === "hashfiles") return hashFiles(args, cwd);
  const fn = PURE_FUNCTIONS[lower];
  if (!fn) {
    throw new ExpressionFunctionError(`Unknown function '${name}()'`);
  }
  return fn(args);
}
