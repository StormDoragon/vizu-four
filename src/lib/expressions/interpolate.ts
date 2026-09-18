import { toBoolean, toDisplayString } from "./coerce";
import { evaluateExpression, type EvalContext } from "./evaluator";

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
