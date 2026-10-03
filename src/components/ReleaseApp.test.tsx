// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReleaseApp } from "./ReleaseApp";
import { releaseFixture } from "@/lib/release/fixtures";
import { analyzeRelease, renderNotes } from "@/lib/release/analysis";

const fetcher = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fill() {
  fireEvent.change(screen.getByLabelText("Public GitHub repository"), { target: { value: "example/project" } });
  fireEvent.change(screen.getByLabelText("Base ref or tag"), { target: { value: "v1" } });
}
function response(messages?: string[]) { const analysis = analyzeRelease(releaseFixture(messages)); return { analysis, notes: renderNotes(analysis) }; }

describe("Release interface", () => {
  it("links Debug and Release and defaults to no AI sharing", () => {
    render(<ReleaseApp />); expect(screen.getByRole("link", { name: "Debug" })).toHaveAttribute("href", "/"); expect(screen.getByRole("link", { name: "Release" })).toHaveAttribute("aria-current", "page"); expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(screen.getByText(/sends eligible public change titles to Anthropic/)).toBeInTheDocument();
  });
  it("collects refs, displays both drafts, exclusions, and evidence", async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => response() });
    render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" }));
    expect(await screen.findByText("1 release-worthy / 2 changes")).toBeInTheDocument();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ repository: "example/project", base: "v1", head: "main", useAi: false });
    expect(screen.getByLabelText("Technical release notes")).toHaveValue(response().notes.technical);
    fireEvent.click(screen.getByRole("button", { name: "Customer" })); expect(screen.getByLabelText("Customer release notes")).toHaveValue(response().notes.customer);
    expect(screen.getByText(/chore: refresh tooling · Excluded/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0000001" })).toHaveAttribute("href", response().analysis.changes[0].evidence[0].url);
  });
  it("shows loading and prevents duplicate submissions", async () => {
    let complete!: (value: unknown) => void; fetcher.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" }));
    expect(screen.getByRole("button", { name: "Analyzing changes…" })).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("Collecting commits");
    complete({ ok: true, json: async () => response([]) }); await screen.findByText("These refs contain no new commits."); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("shows a friendly error when the server returns a non-JSON response", async () => {
    fetcher.mockResolvedValue({ ok: false, status: 502, headers: new Headers({ "content-type": "text/html" }), json: async () => { throw new SyntaxError("Unexpected token '<'"); } });
    render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Release analysis failed. Please try again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Unexpected token");
  });
  it("validates locally without a network call", async () => {
    render(<ReleaseApp />); fill(); fireEvent.change(screen.getByLabelText("Head ref"), { target: { value: "main...evil" } }); fireEvent.click(screen.getByRole("button", { name: "Analyze release" })); expect(await screen.findByRole("alert")).toHaveTextContent("Use a tag"); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["GitHub public API limit reached.", "Public repository or ref not found."])("shows actionable API error", async error => {
    fetcher.mockResolvedValue({ ok: false, json: async () => ({ error }) }); render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" })); expect(await screen.findByRole("alert")).toHaveTextContent(error); expect(screen.getByRole("button", { name: "Analyze release" })).toBeEnabled();
  });
  it("hides security details, surfaces warnings, and renders untrusted titles as text", async () => {
    const data = response(["fix: security bypass secret details", "feat: <script>bad</script>"]); data.analysis.warnings.push("Enrichment incomplete.");
    fetcher.mockResolvedValue({ ok: true, json: async () => data }); const { container } = render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" }));
    await screen.findByText("Enrichment incomplete."); expect(container.querySelector("script")).toBeNull(); expect(screen.queryByText(/security bypass secret details/)).not.toBeInTheDocument();
  });
  it("copies the selected audience and handles clipboard failure", async () => {
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    fetcher.mockResolvedValue({ ok: true, json: async () => response() }); render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" })); await screen.findByText("1 release-worthy / 2 changes");
    fireEvent.click(screen.getByRole("button", { name: "Customer" })); fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" })); await screen.findByText("Copied Markdown."); expect(copy).toHaveBeenCalledWith(response().notes.customer);
    copy.mockRejectedValue(new Error("denied")); fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" })); await screen.findByText(/Clipboard unavailable/);
  });
  it("aborts in-flight work on navigation away", async () => {
    fetcher.mockReturnValue(new Promise(() => {})); const view = render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" })); view.unmount(); await waitFor(() => expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true));
  });
  it("edits and includes an excluded change, copies the revised notes, and resets", async () => {
    const data = response(["feat: add CSV export", "miscellaneous change"]);
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    fetcher.mockResolvedValue({ ok: true, json: async () => data });
    render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" }));
    await screen.findByText("1 release-worthy / 2 changes");
    const id = "2";
    fireEvent.click(screen.getByLabelText(`Include change ${id}`));
    fireEvent.change(screen.getByLabelText(`Customer wording ${id}`), { target: { value: "Choose a report format" } });
    fireEvent.click(screen.getByRole("button", { name: "Customer" }));
    expect((screen.getByLabelText("Customer release notes") as HTMLTextAreaElement).value).toContain("Choose a report format");
    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(expect.stringContaining("Choose a report format")));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining(data.analysis.changes[1].evidence[0].url));
    fireEvent.click(screen.getByRole("button", { name: "Reset draft edits" }));
    expect(screen.getByLabelText("Customer release notes")).toHaveValue(data.notes.customer);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("resets a newly sensitive change without losing unrelated edits", async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => response(["feat: add reports", "feat: add export"]) });
    render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" }));
    await screen.findByText("2 release-worthy / 2 changes");
    fireEvent.change(screen.getByLabelText("Customer wording 2"), { target: { value: "Download a report" } });
    fireEvent.change(screen.getByLabelText("Technical wording 1"), { target: { value: "sanitize UI labels" } });
    expect(screen.queryByLabelText("Technical wording 1")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Technical release notes") as HTMLTextAreaElement).value).not.toContain("sanitize UI labels");
    fireEvent.click(screen.getByRole("button", { name: "Reset change 1" }));
    expect(screen.getByLabelText("Technical wording 1")).toHaveValue("feat: add reports");
    expect(screen.getByLabelText("Customer wording 2")).toHaveValue("Download a report");
  });
  it("does not offer editing for protected details and clears edits on a new range", async () => {
    const data = response(["fix: secret leak in logs", "feat: add reports"]);
    fetcher.mockResolvedValue({ ok: true, json: async () => data });
    render(<ReleaseApp />); fill(); fireEvent.click(screen.getByRole("button", { name: "Analyze release" }));
    await screen.findByText("2 release-worthy / 2 changes");
    expect(screen.queryByLabelText("Customer wording 1")).not.toBeInTheDocument();
    const id = "2";
    fireEvent.change(screen.getByLabelText(`Technical wording ${id}`), { target: { value: "A locally revised report" } });
    expect((screen.getByLabelText("Technical release notes") as HTMLTextAreaElement).value).toContain("A locally revised report");
    fireEvent.click(screen.getByRole("button", { name: "Analyze release" }));
    await screen.findByText("2 release-worthy / 2 changes");
    expect(screen.getByLabelText("Technical release notes")).toHaveValue(data.notes.technical);
  });
});
