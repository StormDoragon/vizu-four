// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareFragmentOpener } from "./ShareFragmentOpener";
import * as apiClient from "@/lib/apiClient";
import { encodeSharePayload, type SharePayload } from "@/lib/share";
import { makeSessionView } from "./testSupport/sessionFixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = "";
});

function token(name: string): string {
  const payload: SharePayload = {
    version: 1,
    yaml: `name: ${name}\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
    breakpoints: [],
    env: {},
    vars: {},
    breakOnFailure: true,
    mockOutputs: {},
    progress: [],
    activeLane: null,
  };
  return encodeSharePayload(payload);
}

function stubCreateSession() {
  return vi.spyOn(apiClient, "createSession").mockResolvedValue({
    session: makeSessionView({ id: "shared-session", awaitingExecutionConsent: true }),
    issues: [],
  });
}

describe("ShareFragmentOpener", () => {
  it("opens the session carried in the URL fragment", async () => {
    const createSession = stubCreateSession();
    window.location.hash = `#${token("From the fragment")}`;

    render(<ShareFragmentOpener />);

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith(
        expect.stringContaining("name: From the fragment"),
        expect.objectContaining({ fromSharedLink: true })
      )
    );
  });

  it("calls a link with no fragment invalid instead of hanging", async () => {
    const createSession = stubCreateSession();
    render(<ShareFragmentOpener />);
    expect(await screen.findByText(/invalid or corrupted/)).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("starts over when a different link replaces the fragment", async () => {
    const createSession = stubCreateSession();
    window.location.hash = `#${token("First")}`;
    render(<ShareFragmentOpener />);
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.location.hash = `#${token("Second")}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() =>
      expect(createSession).toHaveBeenLastCalledWith(
        expect.stringContaining("name: Second"),
        expect.objectContaining({ fromSharedLink: true })
      )
    );
  });
});
