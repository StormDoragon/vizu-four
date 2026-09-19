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
});
