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

// The blocks below close out #13: breadth from real-world usage rather than
// the core grammar (already covered above). Sourced from GitHub's own
// documented examples plus expressions pulled from real, currently-running
// public workflows (actions/checkout, git/git), not invented approximations.

describe("object filters - GitHub's own documented examples", () => {
  it("filters an array of objects down to one property (docs' fruits.*.name example)", () => {
    const c = ctx({
      fruits: [
        { name: "apple", quantity: 1 },
        { name: "orange", quantity: 2 },
        { name: "pear", quantity: 1 },
      ],
    });
    expect(evaluateExpression("fruits.*.name", c)).toEqual(["apple", "orange", "pear"]);
  });

  it("does NOT flatten nested arrays produced by a filter (docs' vegetables.*.ediblePortions example)", () => {
    // GitHub's docs are explicit that the result here is an array of
    // arrays, not a flattened list, "since objects don't preserve order,
    // the order of the output cannot be guaranteed" - fixed key order here
    // (a JS object) makes the assertion deterministic either way.
    const c = ctx({
      vegetables: {
        scallions: { ediblePortions: ["roots", "stalks"] },
        beets: { ediblePortions: ["roots", "stems", "leaves"] },
        artichokes: { ediblePortions: ["hearts", "stems", "leaves"] },
      },
    });
    expect(evaluateExpression("vegetables.*.ediblePortions", c)).toEqual([
      ["roots", "stalks"],
      ["roots", "stems", "leaves"],
      ["hearts", "stems", "leaves"],
    ]);
  });

  it("chains a filter with a multi-level property path (github.event.commits.*.author.email)", () => {
    const c = ctx({
      github: {
        event: {
          commits: [
            { author: { email: "a@example.com" } },
            { author: { email: "b@example.com" } },
          ],
        },
      },
    });
    expect(evaluateExpression("github.event.commits.*.author.email", c)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("combines a filter with contains(), the documented issue-labels pattern", () => {
    const c = ctx({ github: { event: { issue: { labels: [{ name: "bug" }, { name: "P1" }] } } } });
    expect(evaluateExpression("contains(github.event.issue.labels.*.name, 'bug')", c)).toBe(true);
    expect(evaluateExpression("contains(github.event.issue.labels.*.name, 'wontfix')", c)).toBe(false);
  });
});

describe("deeply nested object/array indexing", () => {
  it("indexes through several levels of parsed JSON", () => {
    const c = ctx();
    expect(
      evaluateExpression('fromJSON(\'{"a":{"b":[{"c":1},{"c":2}]}}\').a.b[1].c', c)
    ).toBe(2);
  });

  it("chains bracket indexing on a nested array", () => {
    const c = ctx();
    expect(evaluateExpression("fromJSON('[[1,2],[3,4]]')[1][0]", c)).toBe(3);
  });

  it("mixes dot and bracket access with a dynamic (expression-valued) index", () => {
    const c = ctx({ matrix: { list: ["a", "b", "c"], i: 2 } });
    expect(evaluateExpression("matrix.list[matrix.i]", c)).toBe("c");
  });

  it("returns null (not a throw) for an out-of-range index at the end of a long chain", () => {
    const c = ctx({ matrix: { list: ["a", "b"] } });
    expect(evaluateExpression("matrix.list[10]", c)).toBe(null);
  });

  it("returns null for a missing property in the middle of a long chain, instead of throwing", () => {
    const c = ctx({ github: { event: { pull_request: null } } });
    expect(evaluateExpression("github.event.pull_request.head.sha", c)).toBe(null);
  });
});

describe("mixed-type comparisons (extended)", () => {
  it("coerces null and empty-string both to 0, matching false", () => {
    expect(evaluateExpression("null == false", ctx())).toBe(true);
    expect(evaluateExpression("'' == false", ctx())).toBe(true);
  });

  it("coerces a non-numeric string to NaN, which never equals anything via ==", () => {
    // Docs: string→number coercion parses a legal JSON number, else NaN -
    // 'true' isn't a number in either JS's or GitHub's coercion, so this
    // holds regardless of the divergence documented further below.
    expect(evaluateExpression("'true' == true", ctx())).toBe(false);
    expect(evaluateExpression("'yes' == true", ctx())).toBe(false);
  });

  it("coerces arrays and objects to NaN for cross-type comparisons", () => {
    const c = ctx({ list: [1, 2], obj: { a: 1 } });
    expect(evaluateExpression("list == false", c)).toBe(false);
    expect(evaluateExpression("obj == 0", c)).toBe(false);
  });

  it("only considers two arrays/objects equal when they're the same instance, not deeply equal", () => {
    const c = ctx({ a: [1, 2], b: [1, 2] });
    expect(evaluateExpression("a == b", c)).toBe(false); // same contents, different instances
    expect(evaluateExpression("a == a", c)).toBe(true); // same instance
  });
});

describe("hyphenated identifiers (real job/step ids)", () => {
  // Job and step ids are conventionally kebab-case in real workflows
  // (git/git's CI uses `ci-config`, `windows-build`, ...); GitHub's
  // property-dereference grammar allows hyphens mid-identifier for exactly
  // this reason. `needs.ci-config...` previously threw a syntax error here
  // (the lexer's identifier characters didn't include '-'), which would
  // have broken on a large share of real-world workflows.
  it("dereferences a hyphenated job id under needs.*", () => {
    const c = ctx({ needs: { "ci-config": { outputs: { enabled: "yes" } } } });
    expect(evaluateExpression("needs.ci-config.outputs.enabled == 'yes'", c)).toBe(true);
  });

  it("dereferences a hyphenated matrix key", () => {
    const c = ctx({ matrix: { "node-version": 18 } });
    expect(evaluateExpression("matrix.node-version", c)).toBe(18);
  });

  it("dereferences a hyphenated step id under steps.*", () => {
    const c = ctx({ steps: { "build-and-test": { outcome: "success" } } });
    expect(evaluateExpression("steps.build-and-test.outcome", c)).toBe("success");
  });

  it("still treats a standalone '-' as a syntax error - this engine has no subtraction operator", () => {
    expect(() => evaluateExpression("foo - bar", ctx())).toThrow(ExpressionSyntaxError);
  });
});

describe("real-world expressions from public workflows", () => {
  // actions/checkout's own test workflow (.github/workflows/test.yml):
  // `if: runner.os != 'windows'` relies on the documented case-insensitive
  // string comparison, since this engine's runner.os is capitalized
  // ("Windows") while the workflow compares against lowercase.
  it("actions/checkout: runner.os comparison is case-insensitive even with !=", () => {
    const c = ctx({ runner: { os: "Windows" } });
    expect(evaluateExpression("runner.os == 'windows'", c)).toBe(true);
    expect(evaluateExpression("runner.os != 'windows'", c)).toBe(false);
  });

  // git/git's CI (.github/workflows/main.yml) concurrency group:
  // `github.event.pull_request.number || github.sha` - fall back to the
  // commit sha outside of a pull_request event, where .number is absent.
  it("git/git: falls back to github.sha when pull_request.number is absent", () => {
    const c = ctx({ github: { event: {}, sha: "abc123" } });
    expect(evaluateExpression("github.event.pull_request.number || github.sha", c)).toBe(
      "abc123"
    );
  });
  it("git/git: prefers pull_request.number when present", () => {
    const c = ctx({ github: { event: { pull_request: { number: 42 } }, sha: "abc123" } });
    expect(evaluateExpression("github.event.pull_request.number || github.sha", c)).toBe(42);
  });

  // git/git's ci-config job: `vars.CI_BRANCHES == '' || contains(vars.CI_BRANCHES, github.ref_name)`
  it("git/git: empty-vars-means-all-branches pattern", () => {
    const allBranches = ctx({ vars: { CI_BRANCHES: "" }, github: { ref_name: "some-topic" } });
    expect(
      evaluateExpression("vars.CI_BRANCHES == '' || contains(vars.CI_BRANCHES, github.ref_name)", allBranches)
    ).toBe(true);

    const restricted = ctx({ vars: { CI_BRANCHES: "main,maint" }, github: { ref_name: "some-topic" } });
    expect(
      evaluateExpression("vars.CI_BRANCHES == '' || contains(vars.CI_BRANCHES, github.ref_name)", restricted)
    ).toBe(false);
  });

  // git/git's dockerized job: a common "conditional flag, else empty
  // string" idiom built entirely out of &&/||, with no ternary operator.
  it("common ternary-via-short-circuit idiom (condition && value || fallback)", () => {
    const priv = ctx({ github: { repository_visibility: "private" } });
    expect(
      evaluateExpression("github.repository_visibility == 'private' && '--pids-limit 16384' || ''", priv)
    ).toBe("--pids-limit 16384");

    const pub = ctx({ github: { repository_visibility: "public" } });
    expect(
      evaluateExpression("github.repository_visibility == 'private' && '--pids-limit 16384' || ''", pub)
    ).toBe("");
  });

  // GitHub's own format() doc example, including the escaped-brace case.
  it("format(): docs' escaped-brace example", () => {
    expect(
      evaluateExpression("format('{{Hello {0} {1} {2}!}}', 'Mona', 'the', 'Octocat')", ctx())
    ).toBe("{Hello Mona the Octocat!}");
  });

  it("common needs-gating pattern: all listed jobs succeeded", () => {
    const c = ctx({
      needs: { build: { result: "success" }, test: { result: "success" } },
    });
    expect(evaluateExpression("!contains(needs.*.result, 'failure')", c)).toBe(true);

    const failed = ctx({
      needs: { build: { result: "success" }, test: { result: "failure" } },
    });
    expect(evaluateExpression("!contains(needs.*.result, 'failure')", failed)).toBe(false);
  });
});

describe("confirmed divergence: numeric string coercion", () => {
  // GitHub's documented type-coercion table (reference/workflows-and-
  // actions/expressions - "Type coercion for comparisons") specifies that a
  // string is "parsed from any legal JSON number format, otherwise NaN."
  // JSON's number grammar is stricter than JavaScript's `Number()`: no hex
  // literals, no leading '+', no leading zeros ahead of a nonzero digit, no
  // bare leading/trailing '.'. This engine's `toNumber()` uses `Number()`
  // directly, so it accepts several string shapes a real runner would
  // treat as NaN. Locked in here as documented, deliberate behavior (see
  // the README's fidelity section) rather than silently drifting further -
  // fixing it is a coercion-grammar change judged out of scope for this
  // pass, which is about test breadth, not rewriting the core grammar.
  it("accepts hex, leading '+', and leading-zero strings that a real runner would treat as NaN", () => {
    expect(evaluateExpression("'0x10' == 16", ctx())).toBe(true); // real runner: NaN == 16 → false
    expect(evaluateExpression("'+5' == 5", ctx())).toBe(true); // real runner: NaN == 5 → false
    expect(evaluateExpression("'007' == 7", ctx())).toBe(true); // real runner: NaN == 7 → false
  });

  it("still treats non-numeric text and comma/underscore-grouped digits as NaN, matching a real runner", () => {
    expect(evaluateExpression("'5,000' == 5000", ctx())).toBe(false);
    expect(evaluateExpression("'1_000' == 1000", ctx())).toBe(false);
  });
});
