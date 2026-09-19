import type { JsonValue } from "../workflow/types";
import type { AstNode } from "./ast";
import { ExpressionSyntaxError, parseExpression } from "./parser";
import { compareRelational, getProperty, ghType, looseEquals, toBoolean, toNumber } from "./coerce";
import { callBuiltin, evalStatusFunction, STATUS_FUNCTIONS } from "./functions";
import { unparse } from "./unparse";
import type { EvalContext } from "./evaluator";

export interface TraceNode {
  type: AstNode["type"];
  /** Expression-syntax label for this sub-expression, e.g. "matrix.node". */
  source: string;
  /** Absent when this node errored or was never evaluated (see `skipped`). */
  value?: JsonValue;
  /** Set on this node and every ancestor once evaluation fails somewhere in
   * this subtree - the message is the same one `evaluateExpression` would
   * throw, bubbled unchanged rather than reworded per node. */
  error?: string;
  /** True only on the node where the error actually originated, so the UI
   * can point at the specific sub-expression that failed rather than
   * flagging every ancestor identically. */
  causedError?: boolean;
  /** Set on the untaken side of `&&`/`||` - GitHub's short-circuit means it
   * genuinely never runs, so the trace shows it as skipped rather than
   * inventing a result for code that didn't execute. */
  skipped?: boolean;
  children: TraceNode[];
  /** Dotted path into a top-level context this node resolves to, e.g.
   * "matrix.node" or "steps.*.outputs.result" - only set for a chain that
   * actually starts at a known context (github/env/vars/secrets/matrix/
   * needs/steps/runner/job/inputs/strategy). */
  contextRef?: string;
  /** Present on a comparison whose operands needed a type coercion that
   * isn't obvious from the source text alone. */
  coercion?: string;
}

export interface TracedEvaluation {
  trace?: TraceNode;
  result?: JsonValue;
  error?: string;
  /** Character offset into the source, for a syntax error caught before any
   * AST (and so any trace) could be built. */
  errorPosition?: number;
}

function contextRootKey(name: string, contexts: Record<string, JsonValue>): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(contexts)) {
    if (key.toLowerCase() === lower) return key;
  }
  return undefined;
}

function done(node: AstNode, value: JsonValue, children: TraceNode[] = []): TraceNode {
  return { type: node.type, source: unparse(node), value, children };
}

function errored(node: AstNode, children: TraceNode[], message: string): TraceNode {
  return { type: node.type, source: unparse(node), error: message, causedError: true, children };
}

/** Propagates the first error found among already-evaluated children,
 * without attempting this node's own evaluation - mirrors an exception
 * thrown by a sub-expression aborting the whole expression in one throw. */
function bubble(node: AstNode, children: TraceNode[]): TraceNode {
  const failed = children.find((c) => c.error);
  return { type: node.type, source: unparse(node), error: failed?.error, children };
}

function walk(node: AstNode, ctx: EvalContext): TraceNode {
  switch (node.type) {
    case "Null":
      return done(node, null);
    case "Bool":
      return done(node, node.value);
    case "Number":
      return done(node, node.value);
    case "String":
      return done(node, node.value);

    case "Identifier": {
      const rootKey = contextRootKey(node.name, ctx.contexts);
      const trace = done(node, rootKey ? (ctx.contexts[rootKey] ?? null) : null);
      if (rootKey) trace.contextRef = rootKey;
      return trace;
    }

    case "Member": {
      const objTrace = walk(node.object, ctx);
      if (objTrace.error) return bubble(node, [objTrace]);
      const obj = objTrace.value ?? null;
      const value = Array.isArray(obj)
        ? obj
            .map((el) => getProperty(el, node.property))
            .filter((v): v is JsonValue => v !== null && v !== undefined)
        : getProperty(obj, node.property);
      const trace = done(node, value, [objTrace]);
      if (objTrace.contextRef) trace.contextRef = `${objTrace.contextRef}.${node.property}`;
      return trace;
    }

    case "Filter": {
      const objTrace = walk(node.object, ctx);
      if (objTrace.error) return bubble(node, [objTrace]);
      const obj = objTrace.value ?? null;
      const value = Array.isArray(obj) ? obj : obj !== null && typeof obj === "object" ? Object.values(obj) : [];
      const trace = done(node, value, [objTrace]);
      if (objTrace.contextRef) trace.contextRef = `${objTrace.contextRef}.*`;
      return trace;
    }

    case "Index": {
      const objTrace = walk(node.object, ctx);
      if (objTrace.error) return bubble(node, [objTrace]);
      const idxTrace = walk(node.index, ctx);
      if (idxTrace.error) return bubble(node, [objTrace, idxTrace]);
      const obj = objTrace.value ?? null;
      const idx = idxTrace.value ?? null;
      let value: JsonValue;
      if (Array.isArray(obj)) {
        value = typeof idx === "number" && Number.isInteger(idx) ? (obj[idx] ?? null) : null;
      } else if (obj !== null && typeof obj === "object") {
        value = getProperty(obj, String(idx));
      } else {
        value = null;
      }
      return done(node, value, [objTrace, idxTrace]);
    }

    case "Call": {
      const lower = node.callee.toLowerCase();
      if (STATUS_FUNCTIONS.has(lower)) {
        if (node.args.length !== 0) {
          return errored(node, [], `${node.callee}() takes no arguments`);
        }
        return done(node, evalStatusFunction(lower, ctx.status));
      }
      const argTraces = node.args.map((a) => walk(a, ctx));
      if (argTraces.some((t) => t.error)) return bubble(node, argTraces);
      try {
        const value = callBuiltin(
          node.callee,
          argTraces.map((t) => t.value ?? null),
          ctx.cwd ?? process.cwd()
        );
        return done(node, value, argTraces);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errored(node, argTraces, message);
      }
    }

    case "Unary": {
      const argTrace = walk(node.argument, ctx);
      if (argTrace.error) return bubble(node, [argTrace]);
      return done(node, !toBoolean(argTrace.value ?? null), [argTrace]);
    }

    case "Binary": {
      const leftTrace = walk(node.left, ctx);
      if (leftTrace.error) return bubble(node, [leftTrace]);
      const rightTrace = walk(node.right, ctx);
      if (rightTrace.error) return bubble(node, [leftTrace, rightTrace]);
      const left = leftTrace.value ?? null;
      const right = rightTrace.value ?? null;
      const ta = ghType(left);
      const tb = ghType(right);
      let value: boolean;
      let coercion: string | undefined;
      if (node.op === "==" || node.op === "!=") {
        const eq = looseEquals(left, right);
        value = node.op === "==" ? eq : !eq;
        if (ta !== tb) {
          coercion = `${ta} vs ${tb}: compared as numbers (${toNumber(left)} ${node.op} ${toNumber(right)})`;
        }
      } else {
        value = compareRelational(node.op, left, right);
        if (ta !== "number" || tb !== "number") {
          coercion = `${ta} vs ${tb}: relational operators always coerce both sides to numbers (${toNumber(left)} ${node.op} ${toNumber(right)})`;
        }
      }
      const trace = done(node, value, [leftTrace, rightTrace]);
      if (coercion) trace.coercion = coercion;
      return trace;
    }

    case "Logical": {
      const leftTrace = walk(node.left, ctx);
      if (leftTrace.error) return bubble(node, [leftTrace]);
      const leftTruthy = toBoolean(leftTrace.value ?? null);
      const shortCircuits = node.op === "&&" ? !leftTruthy : leftTruthy;
      if (shortCircuits) {
        const skipped: TraceNode = { type: node.right.type, source: unparse(node.right), children: [], skipped: true };
        return done(node, leftTrace.value ?? null, [leftTrace, skipped]);
      }
      const rightTrace = walk(node.right, ctx);
      if (rightTrace.error) return bubble(node, [leftTrace, rightTrace]);
      return done(node, rightTrace.value ?? null, [leftTrace, rightTrace]);
    }
  }
}

/**
 * Evaluates an expression the same way `evaluateExpression` does, but
 * returns the full sub-expression-by-sub-expression tree alongside the
 * final result - built for the playground's "how did it get there" view,
 * not for the engine's own `if:`/output evaluation (which still goes
 * through the plain, unshadowed `evaluateExpression`).
 */
export function evaluateExpressionTraced(src: string, ctx: EvalContext): TracedEvaluation {
  let ast: AstNode;
  try {
    ast = parseExpression(src);
  } catch (err) {
    if (err instanceof ExpressionSyntaxError) {
      return { error: err.message, errorPosition: err.position };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const trace = walk(ast, ctx);
  if (trace.error) return { trace, error: trace.error };
  return { trace, result: trace.value ?? null };
}
