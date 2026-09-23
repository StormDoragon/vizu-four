import { toBoolean, toDisplayString } from "./coerce";
import { evaluateExpression, type EvalContext } from "./evaluator";
import { parseExpression } from "./parser";
import { STATUS_FUNCTIONS } from "./functions";
import type { AstNode } from "./ast";

export interface ExpressionSpan {
  start: number;
  end: number;
  /** Source text between `${{` and `}}`, untrimmed. */
  expr: string;
}

/**
 * Finds every `${{ ... }}` span in a template string. Balances on single
 * quotes so a literal `}}` inside a string argument (e.g.
 * `format('a}}b')`) doesn't prematurely close the expression.
 */
export function findExpressionSpans(template: string): ExpressionSpan[] {
  const spans: ExpressionSpan[] = [];
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("${{", i);
    if (open === -1) break;
    let j = open + 3;
    let inString = false;
    let close = -1;
    while (j < template.length) {
      const c = template[j];
      if (c === "'") {
        // Doubled '' (escaped quote) toggles twice, netting no change - correct.
        inString = !inString;
        j++;
        continue;
      }
      if (!inString && c === "}" && template[j + 1] === "}") {
        close = j;
        break;
      }
      j++;
    }
    if (close === -1) break; // unterminated; leave remainder as literal
    spans.push({ start: open, end: close + 2, expr: template.slice(open + 3, close) });
    i = close + 2;
  }
  return spans;
}

/**
 * The expression inside a single `${{ }}` that wraps the whole (trimmed) text
 * - how one reads when pasted straight out of a workflow file - or the
 * trimmed text itself when there is no such wrapper.
 *
 * `offset` is where `source` starts in the original text. Positions are
 * reported against what was parsed, and without this there was no way back
 * onto what the person actually typed: a caret for a pasted `${{ ... }}`
 * landed four or more columns before the character it meant.
 */
export function unwrapExpression(text: string): { source: string; offset: number } {
  const leading = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const spans = findExpressionSpans(trimmed);
  if (spans.length === 1 && spans[0].start === 0 && spans[0].end === trimmed.length) {
    const inner = spans[0].expr;
    return {
      source: inner.trim(),
      offset: leading + 3 + (inner.length - inner.trimStart().length),
    };
  }
  return { source: trimmed, offset: leading };
}

export interface InterpolateError {
  expr: string;
  message: string;
}

export interface InterpolateResult {
  result: string;
  errors: InterpolateError[];
}

/** Substitutes every `${{ }}` span in `template` with its evaluated, stringified result. */
export function interpolate(template: string, ctx: EvalContext): InterpolateResult {
  const spans = findExpressionSpans(template);
  if (spans.length === 0) return { result: template, errors: [] };

  let result = "";
  let last = 0;
  const errors: InterpolateError[] = [];
  for (const span of spans) {
    result += template.slice(last, span.start);
    try {
      const value = evaluateExpression(span.expr.trim(), ctx);
      result += toDisplayString(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ expr: span.expr.trim(), message });
      result += `<<expression error: ${message}>>`;
    }
    last = span.end;
  }
  result += template.slice(last);
  return { result, errors };
}

function callsStatusFunction(node: AstNode): boolean {
  switch (node.type) {
    case "Call":
      return STATUS_FUNCTIONS.has(node.callee.toLowerCase()) || node.args.some(callsStatusFunction);
    case "Member":
    case "Filter":
      return callsStatusFunction(node.object);
    case "Index":
      return callsStatusFunction(node.object) || callsStatusFunction(node.index);
    case "Unary":
      return callsStatusFunction(node.argument);
    case "Binary":
    case "Logical":
      return callsStatusFunction(node.left) || callsStatusFunction(node.right);
    default:
      return false;
  }
}

/**
 * Whether a condition references one of GitHub's status check functions
 * (`success`, `failure`, `cancelled`, `always`).
 *
 * GitHub applies a default `success()` check to every `if:` that does not
 * reference one, which is why `if: true` on a step still doesn't run after
 * an earlier step failed - the surprise being that writing a condition
 * doesn't opt out of the default, only naming a status function does.
 *
 * Decided on the parsed expression rather than the raw text, so the word
 * appearing inside a string literal doesn't count.
 */
export function referencesStatusFunction(raw: string | undefined): boolean {
  const src = (raw ?? "").trim();
  if (src === "") return false;
  const sources = src.includes("${{") ? findExpressionSpans(src).map((s) => s.expr) : [src];
  return sources.some((source) => {
    try {
      return callsStatusFunction(parseExpression(source.trim()));
    } catch {
      // An unparseable condition fails on its own in evaluateCondition; it
      // certainly hasn't opted out of the default gate.
      return false;
    }
  });
}

export interface ConditionResult {
  result: boolean;
  error?: string;
  /** Set when the condition mixes literal text with `${{ }}` — a well-known
   * GitHub Actions footgun where the string always stringifies non-empty
   * and is therefore always truthy, regardless of the expression's value. */
  alwaysTruthyWarning?: string;
}

/**
 * Evaluates a step/job `if:` condition, replicating GitHub's actual (if
 * surprising) rules:
 *  - No `${{ }}` anywhere -> the whole string is auto-wrapped as one
 *    expression (this is the documented `if:`-only shorthand).
 *  - Exactly one `${{ ... }}` spanning the whole trimmed string -> its raw
 *    evaluated value is used for truthiness (booleans stay booleans).
 *  - Anything else (literal text mixed with `${{ }}`) -> normal string
 *    interpolation runs first, and the *resulting string* is what's tested
 *    for truthiness - which is non-empty (and therefore always true) any
 *    time the surrounding literal text is non-empty. We flag this case.
 */
export function evaluateCondition(
  raw: string | undefined,
  ctx: EvalContext
): ConditionResult {
  const src = (raw ?? "").trim();
  if (src === "") return { result: true };

  try {
    if (!src.includes("${{")) {
      const value = evaluateExpression(src, ctx);
      return { result: toBoolean(value) };
    }

    const spans = findExpressionSpans(src);
    const isWholeExpression =
      spans.length === 1 && spans[0].start === 0 && spans[0].end === src.length;

    if (isWholeExpression) {
      const value = evaluateExpression(spans[0].expr.trim(), ctx);
      return { result: toBoolean(value) };
    }

    const { result: text, errors } = interpolate(src, ctx);
    if (errors.length > 0) {
      return { result: false, error: errors.map((e) => e.message).join("; ") };
    }
    return {
      result: toBoolean(text),
      alwaysTruthyWarning:
        `This condition mixes literal text with `+
        `\${{ }}, so it is stringified and then checked for truthiness - a ` +
        `non-empty result is always true regardless of the expression's ` +
        `value. Wrap the whole condition in \${{ }} (or drop the wrapper ` +
        `entirely) to compare the real value.`,
    };
  } catch (err) {
    return { result: false, error: err instanceof Error ? err.message : String(err) };
  }
}
