// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpressionPlayground } from "./ExpressionPlayground";
import * as apiClient from "@/lib/apiClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExpressionPlayground", () => {
  it("renders the evaluation trace alongside the result", async () => {
    vi.spyOn(apiClient, "evaluateExpression").mockResolvedValue({
      result: true,
      trace: {
        type: "Binary",
        source: "matrix.node == 18",
        value: true,
        children: [
          { type: "Member", source: "matrix.node", value: 18, children: [], contextRef: "matrix.node" },
          { type: "Number", source: "18", value: 18, children: [] },
        ],
      },
    });

    render(<ExpressionPlayground sessionId="s1" laneId="lane-1" />);
    fireEvent.click(screen.getByRole("button", { name: /evaluate/i }));

    await waitFor(() => expect(screen.getByTestId("expression-trace")).toBeInTheDocument());
    expect(screen.getByText("Evaluation steps")).toBeInTheDocument();
  });

  it("shows a caret pointing at the character position of a syntax error", async () => {
    vi.spyOn(apiClient, "evaluateExpression").mockResolvedValue({
      error: "Unexpected token EOF ''",
      errorPosition: 2,
    });

    render(<ExpressionPlayground sessionId="s1" laneId="lane-1" />);
    fireEvent.click(screen.getByRole("button", { name: /evaluate/i }));

    await waitFor(() => expect(screen.getByText(/Unexpected token/)).toBeInTheDocument());
    expect(screen.getByText(/\^/)).toBeInTheDocument();
  });

  it("puts the caret under the text that was evaluated, even after it is edited", async () => {
    vi.spyOn(apiClient, "evaluateExpression").mockResolvedValue({
      error: "Unexpected '=' (did you mean '=='?)",
      errorPosition: 4,
    });
    render(<ExpressionPlayground sessionId="s1" laneId="lane-1" />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "abc = 1" } });
    fireEvent.click(screen.getByRole("button", { name: /evaluate/i }));
    const error = await screen.findByTestId("expression-error");

    // Editing afterwards must not drag the caret onto text it wasn't for.
    fireEvent.change(textarea, { target: { value: "something else entirely" } });
    expect(error.textContent).toBe("Unexpected '=' (did you mean '=='?)\nabc = 1\n    ^");
  });

  it("puts the caret on the line the error is on, for a multi-line expression", async () => {
    vi.spyOn(apiClient, "evaluateExpression").mockResolvedValue({
      error: "Unexpected token EOF ''",
      errorPosition: 9,
    });
    render(<ExpressionPlayground sessionId="s1" laneId="lane-1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a &&\nb ==" } });
    fireEvent.click(screen.getByRole("button", { name: /evaluate/i }));

    const error = await screen.findByTestId("expression-error");
    expect(error.textContent).toBe("Unexpected token EOF ''\nb ==\n    ^");
  });
});

