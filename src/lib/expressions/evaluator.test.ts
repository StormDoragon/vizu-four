import { describe, expect, it } from "vitest";
import { evaluateExpression, ExpressionEvalError, type EvalContext } from "./evaluator";
import { ExpressionSyntaxError } from "./lexer";
import { evaluateCondition, interpolate } from "./interpolate";

function ctx(contexts: Record<string, unknown> = {}, status = { anyFailure: false, cancelled: false }): EvalContext {
  return { contexts: contexts as EvalContext["contexts"], status, cwd: process.cwd() };
}

describe("literals", () => {
  it("parses numbers, including negatives and exponents", () => {
    expect(evaluateExpression("42", ctx())).toBe(42);
    expect(evaluateExpression("-3.5", ctx())).toBe(-3.5);
    expect(evaluateExpression("1e3", ctx())).toBe(1000);
  });

  it("parses NaN and Infinity literals", () => {
    expect(evaluateExpression("NaN", ctx())).toBeNaN();
    expect(evaluateExpression("Infinity", ctx())).toBe(Infinity);
    expect(evaluateExpression("-Infinity", ctx())).toBe(-Infinity);
  });

  it("parses single-quoted strings with doubled-quote escapes", () => {
    expect(evaluateExpression("'hello'", ctx())).toBe("hello");
    expect(evaluateExpression("'it''s a test'", ctx())).toBe("it's a test");
  });

  it("parses booleans and null case-insensitively", () => {
    expect(evaluateExpression("true", ctx())).toBe(true);
    expect(evaluateExpression("FALSE", ctx())).toBe(false);
    expect(evaluateExpression("null", ctx())).toBe(null);
  });
});

describe("context access", () => {
  it("resolves nested member access", () => {
    const c = ctx({ github: { event_name: "push", event: { head_commit: { message: "hi" } } } });
    expect(evaluateExpression("github.event_name", c)).toBe("push");
    expect(evaluateExpression("github.event.head_commit.message", c)).toBe("hi");
  });

  it("is case-insensitive for context and property names", () => {
    const c = ctx({ Github: { Event_Name: "push" } });
    expect(evaluateExpression("github.event_name", c)).toBe("push");
  });

  it("returns null for missing paths instead of throwing", () => {
    const c = ctx({ github: { event: {} } });
    expect(evaluateExpression("github.event.pull_request.merged", c)).toBe(null);
  });

  it("supports bracket indexing for hyphenated keys", () => {
    const c = ctx({ env: { "MY-VAR": "value" } });
    expect(evaluateExpression("env['MY-VAR']", c)).toBe("value");
  });

  it("supports array indexing", () => {
    const c = ctx({ matrix: { versions: [16, 18, 20] } });
    expect(evaluateExpression("matrix.versions[1]", c)).toBe(18);
  });

  it("supports the .* filter over an object map", () => {
    const c = ctx({
      steps: {
        a: { outputs: { result: "one" } },
        b: { outputs: { result: "two" } },
      },
    });
    expect(evaluateExpression("join(steps.*.outputs.result, ',')", c)).toBe("one,two");
  });
});

describe("operators", () => {
  it("evaluates equality with case-insensitive strings", () => {
    expect(evaluateExpression("'Linux' == 'linux'", ctx())).toBe(true);
    expect(evaluateExpression("'a' != 'b'", ctx())).toBe(true);
  });

  it("coerces mismatched types to number for equality", () => {
    expect(evaluateExpression("1 == '1'", ctx())).toBe(true);
    expect(evaluateExpression("true == 1", ctx())).toBe(true);
    expect(evaluateExpression("false == 0", ctx())).toBe(true);
    expect(evaluateExpression("null == 0", ctx())).toBe(true);
  });

  it("never equates NaN to itself", () => {
    expect(evaluateExpression("NaN == NaN", ctx())).toBe(false);
  });

  it("evaluates relational operators", () => {
    expect(evaluateExpression("1 < 2", ctx())).toBe(true);
    expect(evaluateExpression("2 <= 2", ctx())).toBe(true);
    expect(evaluateExpression("3 > 2", ctx())).toBe(true);
  });

  it("coerces both sides of a relational comparison to numbers, even two strings", () => {
    // GitHub's real behavior: unlike `==`/`!=`, relational operators don't
    // special-case two string operands with a lexicographic comparison -
    // both sides go through the same number coercion as every other type
    // combination. 'apple'/'banana' both coerce to NaN, so every relational
    // comparison between them is false, not a lexicographic "apple" < "banana".
    expect(evaluateExpression("'apple' < 'banana'", ctx())).toBe(false);
    expect(evaluateExpression("'apple' > 'banana'", ctx())).toBe(false);
    expect(evaluateExpression("'10' < '9'", ctx())).toBe(false);
    expect(evaluateExpression("'10' > '9'", ctx())).toBe(true);
  });

  it("negates with !", () => {
    expect(evaluateExpression("!false", ctx())).toBe(true);
    expect(evaluateExpression("!''", ctx())).toBe(true);
    expect(evaluateExpression("!'x'", ctx())).toBe(false);
  });

  it("&& and || return an operand value, not a coerced boolean (JS-like short circuit)", () => {
    expect(evaluateExpression("'' || 'fallback'", ctx())).toBe("fallback");
    expect(evaluateExpression("'value' || 'fallback'", ctx())).toBe("value");
    expect(evaluateExpression("'a' && 'b'", ctx())).toBe("b");
    expect(evaluateExpression("false && 'b'", ctx())).toBe(false);
  });

  it("respects precedence: == binds tighter than &&, which binds tighter than ||", () => {
    const c = ctx({ github: { ref: "refs/heads/main" } });
    expect(
      evaluateExpression("github.ref == 'refs/heads/main' && 1 == 1", c)
    ).toBe(true);
  });
});

describe("built-in functions", () => {
  it("contains() on arrays and strings", () => {
    expect(evaluateExpression("contains('refs/heads/main', 'main')", ctx())).toBe(true);
    expect(evaluateExpression("contains(fromJSON('[1,2,3]'), 2)", ctx())).toBe(true);
  });

  it("startsWith / endsWith are case-insensitive", () => {
    expect(evaluateExpression("startsWith('README.md', 'readme')", ctx())).toBe(true);
    expect(evaluateExpression("endsWith('README.MD', '.md')", ctx())).toBe(true);
  });

  it("format() substitutes positional placeholders and escapes braces", () => {
    expect(evaluateExpression("format('{0} of {1}', 1, 3)", ctx())).toBe("1 of 3");
    expect(evaluateExpression("format('{{literal}}')", ctx())).toBe("{literal}");
  });

  it("join() stringifies and joins array elements", () => {
    expect(evaluateExpression("join(fromJSON('[1,2,3]'), '-')", ctx())).toBe("1-2-3");
  });

  it("toJSON() pretty-prints and fromJSON() parses", () => {
    const c = ctx({ matrix: { os: "ubuntu-latest" } });
    expect(evaluateExpression("fromJSON(toJSON(matrix)).os", c)).toBe("ubuntu-latest");
  });

  it("throws ExpressionEvalError for unknown functions", () => {
    expect(() => evaluateExpression("nope(1)", ctx())).toThrow(ExpressionEvalError);
  });

  it("status functions read from ctx.status", () => {
    expect(evaluateExpression("success()", ctx({}, { anyFailure: false, cancelled: false }))).toBe(true);
    expect(evaluateExpression("failure()", ctx({}, { anyFailure: true, cancelled: false }))).toBe(true);
    expect(evaluateExpression("success()", ctx({}, { anyFailure: true, cancelled: false }))).toBe(false);
    expect(evaluateExpression("always()", ctx({}, { anyFailure: true, cancelled: true }))).toBe(true);
    expect(evaluateExpression("cancelled()", ctx({}, { anyFailure: false, cancelled: true }))).toBe(true);
  });
});

describe("syntax errors", () => {
  it("throws ExpressionSyntaxError on unterminated strings", () => {
    expect(() => evaluateExpression("'unterminated", ctx())).toThrow(ExpressionSyntaxError);
  });

  it("throws ExpressionSyntaxError on a stray token", () => {
    expect(() => evaluateExpression("1 +", ctx())).toThrow(ExpressionSyntaxError);
  });
});

describe("interpolate", () => {
  it("substitutes multiple expressions in a template string", () => {
    const c = ctx({ matrix: { os: "ubuntu-latest", node: 18 } });
    const { result, errors } = interpolate("Building on ${{ matrix.os }} with node ${{ matrix.node }}", c);
    expect(result).toBe("Building on ubuntu-latest with node 18");
    expect(errors).toHaveLength(0);
  });

  it("captures per-expression errors without throwing", () => {
    const { result, errors } = interpolate("value: ${{ nope() }}", ctx());
    expect(errors).toHaveLength(1);
    expect(result).toContain("expression error");
  });

  it("balances quotes so a literal-looking }} inside a string doesn't close early", () => {
    const c = ctx();
    const { result, errors } = interpolate("${{ format('a{{b}}c') }}", c);
    expect(errors).toHaveLength(0);
    expect(result).toBe("a{b}c");
  });
});

describe("evaluateCondition", () => {
  it("treats an empty condition as true (no if: means success())", () => {
    expect(evaluateCondition(undefined, ctx()).result).toBe(true);
    expect(evaluateCondition("", ctx()).result).toBe(true);
  });

  it("auto-wraps a bare expression with no ${{ }}", () => {
    const c = ctx({ github: { ref: "refs/heads/main" } });
    expect(evaluateCondition("github.ref == 'refs/heads/main'", c).result).toBe(true);
  });

  it("uses the raw evaluated value when the whole string is one ${{ }}", () => {
    const c = ctx({}, { anyFailure: true, cancelled: false });
    expect(evaluateCondition("${{ failure() }}", c).result).toBe(true);
    expect(evaluateCondition("${{ success() }}", c).result).toBe(false);
  });

  it("flags the always-truthy footgun when literal text is mixed with ${{ }}", () => {
    const c = ctx({ github: { event_name: "pull_request" } });
    const cond = evaluateCondition("${{ github.event_name }} == 'push'", c);
    expect(cond.result).toBe(true); // always true - that's the point of the warning
    expect(cond.alwaysTruthyWarning).toBeDefined();
  });

  it("surfaces evaluation errors instead of throwing", () => {
    const cond = evaluateCondition("${{ nope() }}", ctx());
    expect(cond.result).toBe(false);
    expect(cond.error).toBeDefined();
  });
});
