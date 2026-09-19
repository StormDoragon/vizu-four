// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";
import * as apiClient from "@/lib/apiClient";
import { makeSessionView } from "@/components/testSupport/sessionFixture";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
});

describe("HomePage - one-click failure demo", () => {
  it("creates a session, mocks the second step to fail, runs it, and navigates to the debugger", async () => {
    vi.spyOn(apiClient, "listExamples").mockResolvedValue([]);
    vi.spyOn(apiClient, "getDeploymentConfig").mockResolvedValue({ simulationOnly: false });

    const session = makeSessionView({
      id: "demo-session",
      workflow: {
        name: "One-Click Failure Demo",
        on: "push",
        jobs: {
          build: {
            id: "build",
            needs: [],
            matrix: null,
            steps: [
              { key: "step-0", name: "Install dependencies", run: "echo hi" },
              { key: "step-1", name: "Run tests", run: "exit 1" },
            ],
          },
        },
      },
    });
    const createSession = vi.spyOn(apiClient, "createSession").mockResolvedValue({ session, issues: [] });
    const setMockOutputs = vi.spyOn(apiClient, "setMockOutputs").mockResolvedValue({ session });
    const control = vi.spyOn(apiClient, "control").mockResolvedValue({ session });

    render(<HomePage />);
    fireEvent.click(await screen.findByTestId("failure-demo"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/debug/demo-session"));

    expect(createSession).toHaveBeenCalledWith(expect.stringContaining("Run tests"));
    expect(setMockOutputs).toHaveBeenCalledWith(
      "demo-session",
      "build",
      "step-1",
      expect.objectContaining({ exitCode: 1 })
    );
    expect(control).toHaveBeenCalledWith("demo-session", "runAll");

    // The mock and the run must happen before navigating, in that order -
    // a run without the mock applied first wouldn't actually fail under
    // simulation-only mode.
    const mockOrder = setMockOutputs.mock.invocationCallOrder[0];
    const runOrder = control.mock.invocationCallOrder[0];
    const navOrder = push.mock.invocationCallOrder[0];
    expect(mockOrder).toBeLessThan(runOrder);
    expect(runOrder).toBeLessThan(navOrder);
  });

  it("shows an error instead of navigating when session creation fails", async () => {
    vi.spyOn(apiClient, "listExamples").mockResolvedValue([]);
    vi.spyOn(apiClient, "getDeploymentConfig").mockResolvedValue({ simulationOnly: false });
    vi.spyOn(apiClient, "createSession").mockRejectedValue(new Error("boom"));

    render(<HomePage />);
    fireEvent.click(await screen.findByTestId("failure-demo"));

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
