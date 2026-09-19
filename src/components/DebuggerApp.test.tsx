// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebuggerApp } from "./DebuggerApp";
import * as apiClient from "@/lib/apiClient";
import { makeSessionView } from "./testSupport/sessionFixture";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// These children fetch their own data or wrap a heavy graph library - none
// of that is relevant to the parse-warning banner this test targets, so
// they're stubbed to keep the test isolated and fast.
vi.mock("./WorkflowGraph", () => ({ WorkflowGraph: () => null }));
vi.mock("./ContextInspector", () => ({ ContextInspector: () => null }));
vi.mock("./StepDetailPanel", () => ({ StepDetailPanel: () => null }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DebuggerApp", () => {
  it("renders the parse-warning banner and dismisses it", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "getSession").mockResolvedValue({
      session: makeSessionView({
        parseIssues: [
          { severity: "warning", message: "jobs.build.steps is empty" },
          { severity: "warning", message: "unknown 'needs' target: missing-job" },
        ],
      }),
    });

    render(<DebuggerApp sessionId="session-1" />);

    expect(await screen.findByText(/jobs\.build\.steps is empty/)).toBeInTheDocument();
    expect(screen.getByText(/unknown 'needs' target/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dismiss parse warnings/i }));

    await waitFor(() =>
      expect(screen.queryByText(/jobs\.build\.steps is empty/)).not.toBeInTheDocument()
    );
    // Dismissal is a UI-only toggle - it doesn't wipe the underlying array.
    expect(screen.queryByText(/unknown 'needs' target/)).not.toBeInTheDocument();
  });

  it("renders no parse-warning banner when there are no parse issues", async () => {
    vi.spyOn(apiClient, "getSession").mockResolvedValue({
      session: makeSessionView({ parseIssues: [] }),
    });

    render(<DebuggerApp sessionId="session-1" />);

    await screen.findByText("CI"); // waits for the session to have loaded
    expect(screen.queryByLabelText(/dismiss parse warnings/i)).not.toBeInTheDocument();
  });
});
