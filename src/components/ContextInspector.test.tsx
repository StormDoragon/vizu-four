// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextInspector } from "./ContextInspector";
import * as apiClient from "@/lib/apiClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ContextInspector", () => {
  it("clears a previous fetch error when a later fetch succeeds", async () => {
    const getContext = vi
      .spyOn(apiClient, "getContext")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ context: { env: { FOO: "bar" } }, pointer: 0 });

    const { rerender } = render(
      <ContextInspector sessionId="s1" laneId="build::default" stepIndex={0} revision={0} />
    );

    await screen.findByText("boom");

    // A prop the effect depends on has to change to trigger a refetch -
    // revision is exactly the field that exists for "something changed
    // even though lane/step didn't".
    rerender(<ContextInspector sessionId="s1" laneId="build::default" stepIndex={0} revision={1} />);

    await waitFor(() => expect(screen.queryByText("boom")).not.toBeInTheDocument());
    expect(await screen.findByText("env")).toBeInTheDocument();
    expect(getContext).toHaveBeenCalledTimes(2);
  });

  it("refetches when revision changes even if lane and step index don't", async () => {
    const getContext = vi
      .spyOn(apiClient, "getContext")
      .mockResolvedValueOnce({ context: { env: { FOO: "first" } }, pointer: 0 })
      .mockResolvedValueOnce({ context: { env: { FOO: "second" } }, pointer: 0 });

    const { rerender } = render(
      <ContextInspector sessionId="s1" laneId="build::default" stepIndex={2} revision={0} />
    );
    await screen.findByText("env");
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenLastCalledWith("s1", "build::default", 2);

    rerender(<ContextInspector sessionId="s1" laneId="build::default" stepIndex={2} revision={1} />);

    await waitFor(() => expect(getContext).toHaveBeenCalledTimes(2));
    expect(getContext).toHaveBeenLastCalledWith("s1", "build::default", 2);

    // The refetch's own response is what's now on screen, not the first one.
    await waitFor(() => expect(screen.getByText("env").closest("details")?.textContent).toContain("second"));
  });

  it("shows a placeholder instead of fetching when there is no active lane", () => {
    const getContext = vi.spyOn(apiClient, "getContext");
    render(<ContextInspector sessionId="s1" laneId={null} revision={0} />);
    expect(screen.getByText(/no active lane selected/i)).toBeInTheDocument();
    expect(getContext).not.toHaveBeenCalled();
  });
});
