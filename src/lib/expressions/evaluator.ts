import type { JsonValue } from "../workflow/types";
import type { AstNode } from "./ast";
import { parseExpression } from "./parser";
import {
  compareRelational,
  getProperty,
  looseEquals,
  toBoolean,
} from "./coerce";
import { callBuiltin, evalStatusFunction, STATUS_FUNCTIONS, type StatusFlags } from "./functions";

export class ExpressionEvalError extends Error {}

export interface EvalContext {
  /** Top-level context objects: github, env, vars, secrets, matrix, needs, steps, runner, job, inputs, strategy... */
  contexts: Record<string, JsonValue>;
  status: StatusFlags;
  /** Working directory for hashFiles(); defaults to process.cwd(). */
  cwd?: string;
}

function evalNode(node: AstNode, ctx: EvalContext): JsonValue {
  switch (node.type) {
    case "Null":
      return null;
    case "Bool":
      return node.value;
    case "Number":
      return node.value;
    case "String":
      return node.value;

    case "Identifier": {
      const lower = node.name.toLowerCase();
      for (const key of Object.keys(ctx.contexts)) {
        if (key.toLowerCase() === lower) return ctx.contexts[key] ?? null;
      }
      return null;
    }

    case "Member": {
      const obj = evalNode(node.object, ctx);
      if (Array.isArray(obj)) {
        return obj
          .map((el) => getProperty(el, node.property))
          .filter((v): v is JsonValue => v !== null && v !== undefined);
      }
      return getProperty(obj, node.property);
    }

    case "Filter": {
      const obj = evalNode(node.object, ctx);
      if (Array.isArray(obj)) return obj;
      if (obj !== null && typeof obj === "object") return Object.values(obj);
      return [];
    }

    case "Index": {
      const obj = evalNode(node.object, ctx);
      const idx = evalNode(node.index, ctx);
      if (Array.isArray(obj)) {
        if (typeof idx !== "number" || !Number.isInteger(idx)) return null;
        return obj[idx] ?? null;
      }
      if (obj !== null && typeof obj === "object") {
        return getProperty(obj, String(idx));
      }
      return null;
    }

    case "Call": {
      const lower = node.callee.toLowerCase();
      if (STATUS_FUNCTIONS.has(lower)) {
        if (node.args.length !== 0) {
          throw new ExpressionEvalError(`${node.callee}() takes no arguments`);
        }
        return evalStatusFunction(lower, ctx.status);
      }
      const args = node.args.map((a) => evalNode(a, ctx));
      try {
        return callBuiltin(node.callee, args, ctx.cwd ?? process.cwd());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ExpressionEvalError(message);
      }
    }

    case "Unary":
      return !toBoolean(evalNode(node.argument, ctx));

    case "Binary": {
      const left = evalNode(node.left, ctx);
      const right = evalNode(node.right, ctx);
      switch (node.op) {
        case "==":
          return looseEquals(left, right);
        case "!=":
          return !looseEquals(left, right);
        default:
          return compareRelational(node.op, left, right);
      }
    }

    case "Logical": {
      const left = evalNode(node.left, ctx);
      if (node.op === "&&") {
        return toBoolean(left) ? evalNode(node.right, ctx) : left;
      }
      return toBoolean(left) ? left : evalNode(node.right, ctx);
    }
  }
}

/** Parses and evaluates a bare expression string (no surrounding `${{ }}`). */
export function evaluateExpression(src: string, ctx: EvalContext): JsonValue {
  const ast = parseExpression(src);
  return evalNode(ast, ctx);
}

export { parseExpression } from "./parser";
export { ExpressionSyntaxError } from "./lexer";
