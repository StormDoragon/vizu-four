import { describe, expect, it } from "vitest";
import { unparse } from "./unparse";
import { parseExpression } from "./parser";

function roundTrip(src: string): string {
  return unparse(parseExpression(src));
}

describe("unparse", () => {
  it("renders literals", () => {
    expect(roundTrip("42")).toBe("42");
    expect(roundTrip("true")).toBe("true");
    expect(roundTrip("false")).toBe("false");
    expect(roundTrip("null")).toBe("null");
    expect(roundTrip("'hi'")).toBe("'hi'");
  });

  it("normalizes doubled-quote escaping without changing the value", () => {
    expect(roundTrip("'it''s a test'")).toBe("'it''s a test'");
  });

  it("renders identifiers and member/index/filter chains", () => {
    expect(roundTrip("matrix.node")).toBe("matrix.node");
    expect(roundTrip("steps.*.outputs.result")).toBe("steps.*.outputs.result");
    expect(roundTrip("matrix.versions[1]")).toBe("matrix.versions[1]");
  });

  it("renders calls with their arguments", () => {
    expect(roundTrip("contains(fromJSON('[1,2,3]'), 2)")).toBe("contains(fromJSON('[1,2,3]'), 2)");
    expect(roundTrip("success()")).toBe("success()");
  });

  it("renders unary, binary and logical operators", () => {
    expect(roundTrip("!false")).toBe("!false");
    expect(roundTrip("1 == 2")).toBe("1 == 2");
    expect(roundTrip("a && b")).toBe("a && b");
  });

  it("re-parses back to an equivalent AST for a representative expression", () => {
    const original = "github.ref == 'refs/heads/main' && contains(needs.build.outputs.tags, matrix.tag)";
    const twiceUnparsed = unparse(parseExpression(unparse(parseExpression(original))));
    expect(twiceUnparsed).toBe(unparse(parseExpression(original)));
  });
});
