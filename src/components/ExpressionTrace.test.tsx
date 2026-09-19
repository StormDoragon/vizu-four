// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExpressionTrace } from "./ExpressionTrace";
import { evaluateExpressionTraced } from "@/lib/expressions/trace";
import type { EvalContext } from "@/lib/expressions/evaluator";

function ctx(contexts: Record<string, unknown> = {}): EvalContext {
  return { contexts: contexts as EvalContext["contexts"], status: { anyFailure: false, cancelled: false } };
}

describe("ExpressionTrace", () => {
  it("shows the source and value for every sub-expression", () => {
    const { trace } = evaluateExpressionTraced("matrix.node == 18", ctx({ matrix: { node: 18 } }));
    render(<ExpressionTrace trace={trace!} />);
    expect(screen.getByText("matrix.node == 18")).toBeInTheDocument();
    expect(screen.getAllByText("matrix.node").length).toBeGreaterThan(0);
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("tags the context reference on the identifier chain", () => {
    const { trace } = evaluateExpressionTraced("matrix.node", ctx({ matrix: { node: 18 } }));
    render(<ExpressionTrace trace={trace!} />);
    const tags = screen.getAllByTitle("References this context value");
    expect(tags.map((t) => t.textContent)).toContain("matrix.node");
  });

  it("shows the coercion note for a mismatched-type comparison", () => {
    const { trace } = evaluateExpressionTraced("1 == '1'", ctx());
    render(<ExpressionTrace trace={trace!} />);
    expect(screen.getByTestId("trace-coercion")).toHaveTextContent(/number vs string/);
  });

  it("marks the failing sub-expression and shows a bubbled marker on its ancestor", () => {
    const { trace } = evaluateExpressionTraced("contains(fromJSON('not json'), 1)", ctx());
    render(<ExpressionTrace trace={trace!} />);
    expect(screen.getByText(/invalid JSON/)).toBeInTheDocument();
    expect(screen.getByText("↳ failed below")).toBeInTheDocument();
  });

  it("shows the short-circuited side as not evaluated", () => {
    const { trace } = evaluateExpressionTraced("false && nope(1)", ctx());
    render(<ExpressionTrace trace={trace!} />);
    expect(screen.getByText("not evaluated — short-circuited")).toBeInTheDocument();
  });
});
