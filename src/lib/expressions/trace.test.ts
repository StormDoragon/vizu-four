import { describe, expect, it } from "vitest";
import { evaluateExpressionTraced } from "./trace";
import { evaluateExpression, ExpressionEvalError, type EvalContext } from "./evaluator";

function ctx(contexts: Record<string, unknown> = {}, status = { anyFailure: false, cancelled: false }): EvalContext {
  return { contexts: contexts as EvalContext["contexts"], status, cwd: process.cwd() };
}

// Every string here is evaluated both ways and must agree - this is the
// drift guard: evaluateExpressionTraced mirrors evaluateExpression's
// dispatch by hand (for tracing), so this is what keeps the two from
// quietly diverging the way the three status-color maps once did.
const AGREEMENT_FIXTURES: [string, Record<string, unknown>?][] = [
  ["42"],
  ["-3.5"],
  ["1e3"],
  ["true"],
  ["FALSE"],
  ["null"],
  ["'hello'"],
  ["'it''s a test'"],
  ["github.event_name", { github: { event_name: "push" } }],
  ["github.event.head_commit.message", { github: { event: { head_commit: { message: "hi" } } } }],
  ["env['MY-VAR']", { env: { "MY-VAR": "value" } }],
  ["matrix.versions[1]", { matrix: { versions: [16, 18, 20] } }],
  ["join(steps.*.outputs.result, ',')", { steps: { a: { outputs: { result: "one" } }, b: { outputs: { result: "two" } } } }],
  ["'Linux' == 'linux'"],
  ["'a' != 'b'"],
  ["1 == '1'"],
  ["true == 1"],
  ["false == 0"],
  ["null == 0"],
  ["NaN == NaN"],
  ["1 < 2"],
  ["2 <= 2"],
  ["3 > 2"],
  ["'apple' < 'banana'"],
  ["'10' < '9'"],
  ["!false"],
  ["!''"],
  ["'' || 'fallback'"],
  ["'value' || 'fallback'"],
  ["'a' && 'b'"],
  ["false && 'b'"],
  ["contains('refs/heads/main', 'main')"],
  ["contains(fromJSON('[1,2,3]'), 2)"],
  ["startsWith('README.md', 'readme')"],
  ["format('{0} of {1}', 1, 3)"],
  ["join(fromJSON('[1,2,3]'), '-')"],
  ["fromJSON(toJSON(matrix)).os", { matrix: { os: "ubuntu-latest" } }],
  ["success()"],
  ["failure()"],
];

describe("evaluateExpressionTraced agrees with evaluateExpression", () => {
  for (const [src, contexts] of AGREEMENT_FIXTURES) {
    it(`matches for: ${src}`, () => {
      const traced = evaluateExpressionTraced(src, ctx(contexts));
      const direct = evaluateExpression(src, ctx(contexts));
      expect(traced.result).toEqual(direct);
      expect(traced.error).toBeUndefined();
    });
  }

  it("bubbles the same error message as the thrown exception, for an unknown function", () => {
    const src = "nope(1)";
    let directMessage: string | undefined;
    try {
      evaluateExpression(src, ctx());
    } catch (err) {
      directMessage = err instanceof ExpressionEvalError ? err.message : undefined;
    }
    const traced = evaluateExpressionTraced(src, ctx());
    expect(traced.error).toBe(directMessage);
    expect(traced.result).toBeUndefined();
  });

  it("bubbles the same error for a nested call failure (fromJSON inside contains)", () => {
    const src = "contains(fromJSON('not json'), 1)";
    let directMessage: string | undefined;
    try {
      evaluateExpression(src, ctx());
    } catch (err) {
      directMessage = err instanceof Error ? err.message : undefined;
    }
    const traced = evaluateExpressionTraced(src, ctx());
    expect(traced.error).toBe(directMessage);
  });
});

describe("evaluateExpressionTraced - error localization", () => {
  it("marks the failing sub-expression with causedError, and bubbles without re-marking ancestors", () => {
    const traced = evaluateExpressionTraced("contains(fromJSON('not json'), 1)", ctx());
    const root = traced.trace!;
    expect(root.error).toBeDefined();
    expect(root.causedError).toBeUndefined();
    const fromJsonCall = root.children[0];
    expect(fromJsonCall.source).toBe("fromJSON('not json')");
    expect(fromJsonCall.causedError).toBe(true);
    expect(fromJsonCall.error).toBe(root.error);
  });

  it("returns a character position for a syntax error, with no trace", () => {
    const traced = evaluateExpressionTraced("1 +", ctx());
    expect(traced.error).toBeDefined();
    expect(traced.errorPosition).toBeTypeOf("number");
    expect(traced.trace).toBeUndefined();
  });
});

describe("evaluateExpressionTraced - context references", () => {
  it("tags an identifier that resolves to a known top-level context", () => {
    const traced = evaluateExpressionTraced("matrix.node", ctx({ matrix: { node: 18 } }));
    expect(traced.trace!.contextRef).toBe("matrix.node");
  });

  it("extends the path through a .* filter", () => {
    const traced = evaluateExpressionTraced(
      "steps.*.outputs.result",
      ctx({ steps: { a: { outputs: { result: "x" } } } })
    );
    expect(traced.trace!.contextRef).toBe("steps.*.outputs.result");
  });

  it("does not tag an identifier that isn't a known context", () => {
    const traced = evaluateExpressionTraced("true", ctx());
    expect(traced.trace!.contextRef).toBeUndefined();
  });
});

describe("evaluateExpressionTraced - coercion notes", () => {
  it("notes a type coercion for == across mismatched types", () => {
    const traced = evaluateExpressionTraced("1 == '1'", ctx());
    expect(traced.trace!.coercion).toMatch(/number vs string/);
  });

  it("does not note anything for a same-type ==", () => {
    const traced = evaluateExpressionTraced("1 == 1", ctx());
    expect(traced.trace!.coercion).toBeUndefined();
  });

  it("notes a coercion for a relational comparison against a non-number", () => {
    const traced = evaluateExpressionTraced("'10' < '9'", ctx());
    expect(traced.trace!.coercion).toMatch(/relational operators always coerce/);
  });
});

describe("evaluateExpressionTraced - short-circuiting", () => {
  it("marks the untaken side of && as skipped, not evaluated", () => {
    const traced = evaluateExpressionTraced("false && nope(1)", ctx());
    expect(traced.error).toBeUndefined();
    expect(traced.result).toBe(false);
    const rightChild = traced.trace!.children[1];
    expect(rightChild.skipped).toBe(true);
    expect(rightChild.value).toBeUndefined();
    expect(rightChild.error).toBeUndefined();
  });

  it("marks the untaken side of || as skipped, not evaluated", () => {
    const traced = evaluateExpressionTraced("'value' || nope(1)", ctx());
    expect(traced.result).toBe("value");
    expect(traced.trace!.children[1].skipped).toBe(true);
  });
});
