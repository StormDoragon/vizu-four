// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareOpener } from "./ShareOpener";
import * as apiClient from "@/lib/apiClient";
import { encodeSharePayload } from "@/lib/share";
import { makeSessionView } from "./testSupport/sessionFixture";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

afterEach(() => {
  vi.restoreAllMocks();
  replace.mockClear();
});

const YAML = `name: Shared
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo one
      - run: echo two
`;

function shareToken(progressSteps: number) {
  return encodeSharePayload({
    version: 1,
    yaml: YAML,
    breakpoints: [],
    env: {},
    vars: {},
    breakOnFailure: true,
    mockOutputs: {},
    progress: progressSteps > 0 ? [{ jobId: "build", matrix: {}, stepIndex: progressSteps }] : [],
    activeLane: null,
  });
}

function stubSession(overrides: Parameters<typeof makeSessionView>[0] = {}) {
  const session = makeSessionView({
    id: "shared-session",
    awaitingExecutionConsent: true,
    workflow: {
      name: "Shared",
      on: "push",
      jobs: {
        build: {
          id: "build",
          needs: [],
          matrix: null,
          steps: [
            { key: "step-0", run: "echo one" },
            { key: "step-1", run: "echo two" },
          ],
        },
      },
    },
    ...overrides,
  });
  vi.spyOn(apiClient, "createSession").mockResolvedValue({ session, issues: [] });
  return session;
}

describe("ShareOpener consent", () => {
  it("does not run anything on open", async () => {
    const session = stubSession();
    const control = vi.spyOn(apiClient, "control");
    const consent = vi.spyOn(apiClient, "grantExecutionConsent");

    render(<ShareOpener token={shareToken(2)} />);
    await screen.findByTestId("share-inspect");

    expect(apiClient.createSession).toHaveBeenCalledWith(
      expect.stringContaining("Shared"),
      expect.objectContaining({ fromSharedLink: true })
    );
    expect(control).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(session.id).toBe("shared-session");
  });

  it("shows the workflow and how much the link wants to replay", async () => {
    stubSession();
    render(<ShareOpener token={shareToken(2)} />);
    expect(await screen.findByText(/2 steps across 1 lane/)).toBeInTheDocument();
    expect(screen.getByText(/echo one/)).toBeInTheDocument();
  });

  it("inspecting navigates without consenting or executing", async () => {
    stubSession();
    const control = vi.spyOn(apiClient, "control");
    const consent = vi.spyOn(apiClient, "grantExecutionConsent");

    render(<ShareOpener token={shareToken(2)} />);
    fireEvent.click(await screen.findByTestId("share-inspect"));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/debug/shared-session?shared=1"));
    expect(consent).not.toHaveBeenCalled();
    expect(control).not.toHaveBeenCalled();
  });

  it("replaying consents first, then steps", async () => {
    const session = stubSession();
    const consent = vi
      .spyOn(apiClient, "grantExecutionConsent")
      .mockResolvedValue({ session: { ...session, awaitingExecutionConsent: false } });
    const control = vi.spyOn(apiClient, "control").mockResolvedValue({ session });

    render(<ShareOpener token={shareToken(1)} />);
    fireEvent.click(await screen.findByTestId("share-replay"));

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(consent).toHaveBeenCalledWith("shared-session");
    expect(consent.mock.invocationCallOrder[0]).toBeLessThan(control.mock.invocationCallOrder[0]);
  });

  it("warns that replaying runs commands for real when execution is enabled", async () => {
    stubSession({ simulationOnly: false });
    render(<ShareOpener token={shareToken(2)} />);
    expect(await screen.findByTestId("share-execution-warning")).toBeInTheDocument();
  });

  it("does not warn when the deployment never executes run: steps", async () => {
    stubSession({ simulationOnly: true });
    render(<ShareOpener token={shareToken(2)} />);
    await screen.findByTestId("share-inspect");
    expect(screen.queryByTestId("share-execution-warning")).toBeNull();
  });

  it("offers nothing to replay when the link shares no progress", async () => {
    stubSession();
    render(<ShareOpener token={shareToken(0)} />);
    expect(await screen.findByTestId("share-replay")).toBeDisabled();
    expect(screen.getByText(/No steps/)).toBeInTheDocument();
  });
});
