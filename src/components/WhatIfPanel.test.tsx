// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatIfPanel } from "./WhatIfPanel";
import * as apiClient from "@/lib/apiClient";
import { makeSessionView } from "./testSupport/sessionFixture";

afterEach(() => {
  vi.restoreAllMocks();
});

function withConfig(config: Partial<ReturnType<typeof makeSessionView>["config"]>) {
  const base = makeSessionView();
  return makeSessionView({ config: { ...base.config, ...config } });
}

function panel(session: ReturnType<typeof makeSessionView>) {
  return (
    <WhatIfPanel
      session={session}
      onApplied={() => {}}
      suggestedSecretNames={[]}
      persist={true}
      onTogglePersist={() => {}}
    />
  );
}

describe("WhatIfPanel", () => {
  it("deletes an override whose row was removed", async () => {
    const applyWhatIf = vi
      .spyOn(apiClient, "applyWhatIf")
      .mockResolvedValue({ session: withConfig({}) });
    render(panel(withConfig({ envOverrides: { OLD: "1" } })));

    fireEvent.click(screen.getAllByText("✕")[0]);
    fireEvent.click(screen.getByTestId("whatif-apply"));

    await waitFor(() => expect(applyWhatIf).toHaveBeenCalled());
    expect(applyWhatIf.mock.calls[0][1].env).toEqual({ OLD: null });
  });

  it("never deletes overrides that reached the session after the panel loaded", async () => {
    // The saved-state restore applies overrides after the page loads, and a
    // second tab on the same session can too. The rows were loaded before
    // those existed, so diffing deletions against the session's current keys
    // sent `null` for every one of them on the next Apply - deleted unseen,
    // and the stored copy overwritten by the persistence mirror after it.
    const applyWhatIf = vi
      .spyOn(apiClient, "applyWhatIf")
      .mockResolvedValue({ session: withConfig({}) });
    const { rerender } = render(panel(withConfig({})));
    rerender(
      panel(
        withConfig({
          envOverrides: { RESTORED_ENV: "1" },
          vars: { RESTORED_VAR: "2" },
          secretNames: ["GITHUB_TOKEN", "LATE_SECRET"],
        })
      )
    );

    fireEvent.click(screen.getByTestId("kv-add-vars"));
    fireEvent.change(screen.getByTestId("kv-vars-key-0"), { target: { value: "NEW" } });
    fireEvent.change(screen.getByTestId("kv-vars-value-0"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("whatif-apply"));

    await waitFor(() => expect(applyWhatIf).toHaveBeenCalled());
    const patch = applyWhatIf.mock.calls[0][1];
    expect(patch.env ?? {}).not.toHaveProperty("RESTORED_ENV");
    expect(patch.vars).toEqual({ NEW: "x" });
    expect(patch.secrets ?? {}).not.toHaveProperty("LATE_SECRET");
  });
});
