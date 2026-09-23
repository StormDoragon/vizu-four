// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockOutputsEditor } from "./MockOutputsEditor";
import * as apiClient from "@/lib/apiClient";
import { makeSessionView } from "./testSupport/sessionFixture";

afterEach(() => {
  vi.restoreAllMocks();
});

function renderEditor(isRunStep: boolean) {
  const session = makeSessionView();
  const onUpdated = vi.fn();
  render(
    <MockOutputsEditor
      session={session}
      jobId="build"
      stepKey="step-0"
      isRunStep={isRunStep}
      onUpdated={onUpdated}
    />
  );
  return { session, onUpdated };
}

describe("MockOutputsEditor", () => {
  it("confirms a mock the server kept", async () => {
    const { session, onUpdated } = renderEditor(true);
    const kept = makeSessionView({
      mockOutputs: { "build:step-0": { outputs: { version: "1.2.3" } } },
    });
    const setMock = vi.spyOn(apiClient, "setMockOutputs").mockResolvedValue({ session: kept });

    fireEvent.click(screen.getByTestId("kv-add-mock"));
    fireEvent.change(screen.getByTestId("kv-mock-key-0"), { target: { value: "version" } });
    fireEvent.change(screen.getByTestId("kv-mock-value-0"), { target: { value: "1.2.3" } });
    fireEvent.click(screen.getByTestId("mock-apply"));

    expect(await screen.findByText(/Applied/)).toBeInTheDocument();
    expect(setMock).toHaveBeenCalledWith(session.id, "build", "step-0", {
      outputs: { version: "1.2.3" },
      exitCode: undefined,
      stderr: undefined,
    });
    expect(onUpdated).toHaveBeenCalledWith(kept);
  });

  it("says a run: step will still run when there was nothing to stub", async () => {
    // The server drops a mock with no outputs and no failure. The editor
    // used to report "Applied" anyway - and for a `run:` step, where a mock
    // means "don't execute this", that told someone a command was stubbed
    // out right before it ran for real.
    renderEditor(true);
    vi.spyOn(apiClient, "setMockOutputs").mockResolvedValue({ session: makeSessionView() });

    fireEvent.click(screen.getByTestId("mock-apply"));

    expect(await screen.findByText(/No mock is set/)).toBeInTheDocument();
    expect(screen.getByText(/will run normally/)).toBeInTheDocument();
    expect(screen.queryByText(/Applied/)).toBeNull();
  });

  it("says no mock is set for a uses: step too, without claiming it runs a command", async () => {
    renderEditor(false);
    vi.spyOn(apiClient, "setMockOutputs").mockResolvedValue({ session: makeSessionView() });

    fireEvent.click(screen.getByTestId("mock-apply"));

    expect(await screen.findByText(/No mock is set/)).toBeInTheDocument();
    expect(screen.queryByText(/will run normally/)).toBeNull();
    expect(screen.queryByText(/Applied/)).toBeNull();
  });
});
