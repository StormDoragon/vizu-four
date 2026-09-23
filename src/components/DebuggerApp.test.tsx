// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebuggerApp } from "./DebuggerApp";
import * as apiClient from "@/lib/apiClient";
import * as workflowSourceCache from "@/lib/workflowSourceCache";
import { makeSessionView } from "./testSupport/sessionFixture";

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

// These children fetch their own data or wrap a heavy graph library - none
// of that is relevant to the parse-warning banner this test targets, so
// they're stubbed to keep the test isolated and fast.
vi.mock("./WorkflowGraph", () => ({ WorkflowGraph: () => null }));
vi.mock("./ContextInspector", () => ({ ContextInspector: () => null }));
vi.mock("./StepDetailPanel", () => ({ StepDetailPanel: () => null }));

afterEach(() => {
  vi.restoreAllMocks();
  mockSearchParams = new URLSearchParams();
});

describe("DebuggerApp", () => {
  it("reports a failed pause-on-failure toggle instead of failing silently", async () => {
    // Sessions live in memory: once one is reaped, or the server restarts,
    // every call answers 404. Every other control surfaces that; this one
    // left an unhandled rejection and a checkbox that just snapped back.
    const user = userEvent.setup();
    vi.spyOn(apiClient, "getSession").mockResolvedValue({ session: makeSessionView() });
    vi.spyOn(apiClient, "applyWhatIf").mockRejectedValue(new Error("Session not found"));

    render(<DebuggerApp sessionId="session-1" />);
    await user.click(await screen.findByLabelText(/pause on failure/i));

    expect(await screen.findByText("Session not found")).toBeInTheDocument();
  });

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

  it("shows the shared-session banner only when the shared query param is set", async () => {
    mockSearchParams = new URLSearchParams("shared=1");
    vi.spyOn(apiClient, "getSession").mockResolvedValue({ session: makeSessionView() });

    render(<DebuggerApp sessionId="session-1" />);

    expect(await screen.findByTestId("shared-session-banner")).toBeInTheDocument();
  });

  it("does not show the shared-session banner for a normal session", async () => {
    vi.spyOn(apiClient, "getSession").mockResolvedValue({ session: makeSessionView() });

    render(<DebuggerApp sessionId="session-1" />);

    await screen.findByText("CI");
    expect(screen.queryByTestId("shared-session-banner")).not.toBeInTheDocument();
  });

  it("opens the share dialog with a link when the workflow source is cached", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "getSession").mockResolvedValue({ session: makeSessionView() });
    vi.spyOn(workflowSourceCache, "loadWorkflowSource").mockReturnValue("name: CI\non: push\njobs: {}");

    render(<DebuggerApp sessionId="session-1" />);
    await screen.findByText("CI");

    await user.click(screen.getByTestId("share-toggle"));

    const input = await screen.findByTestId("share-url");
    expect((input as HTMLInputElement).value).toMatch(/\/share\//);
  });

  it("shows an error instead of a link when the workflow source isn't cached", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "getSession").mockResolvedValue({ session: makeSessionView() });
    vi.spyOn(workflowSourceCache, "loadWorkflowSource").mockReturnValue(null);

    render(<DebuggerApp sessionId="session-1" />);
    await screen.findByText("CI");

    await user.click(screen.getByTestId("share-toggle"));

    expect(await screen.findByText(/isn't available in this browser/)).toBeInTheDocument();
    expect(screen.queryByTestId("share-dialog")).not.toBeInTheDocument();
  });
});

describe("DebuggerApp consent for a shared session", () => {
  it("offers a way out of the inspect-only state", async () => {
    // Inspecting a link lands here with execution still refused, so the
    // decision has to be reachable from this screen - the share page that
    // offered it is gone by now.
    const pending = makeSessionView({ awaitingExecutionConsent: true });
    vi.spyOn(apiClient, "getSession").mockResolvedValue({ session: pending });
    const consent = vi
      .spyOn(apiClient, "grantExecutionConsent")
      .mockResolvedValue({ session: { ...pending, awaitingExecutionConsent: false } });

    render(<DebuggerApp sessionId="session-1" />);
    const banner = await screen.findByTestId("consent-banner");
    expect(banner).toHaveTextContent(/Nothing in this shared session can run yet/);

    fireEvent.click(screen.getByTestId("allow-execution"));
    await waitFor(() => expect(consent).toHaveBeenCalledWith("session-1"));
    await waitFor(() => expect(screen.queryByTestId("consent-banner")).toBeNull());
  });

  it("warns about real execution only when this deployment executes", async () => {
    vi.spyOn(apiClient, "getSession").mockResolvedValue({
      session: makeSessionView({ awaitingExecutionConsent: true, simulationOnly: false }),
    });
    render(<DebuggerApp sessionId="session-1" />);
    expect(await screen.findByTestId("consent-banner")).toHaveTextContent(/for real on this machine/);
  });

  it("shows no banner for a session the visitor created themselves", async () => {
    vi.spyOn(apiClient, "getSession").mockResolvedValue({ session: makeSessionView() });
    render(<DebuggerApp sessionId="session-1" />);
    await screen.findByText("CI");
    expect(screen.queryByTestId("consent-banner")).toBeNull();
  });
});
