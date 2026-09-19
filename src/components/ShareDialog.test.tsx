// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "./ShareDialog";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShareDialog", () => {
  it("shows the share URL and copies it to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ShareDialog url="http://localhost/share/abc123" onClose={vi.fn()} />);

    expect(screen.getByTestId("share-url")).toHaveValue("http://localhost/share/abc123");
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith("http://localhost/share/abc123");
    await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument());
  });

  it("calls onClose when dismissed", () => {
    const onClose = vi.fn();
    render(<ShareDialog url="http://localhost/share/abc123" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when clicking inside the dialog content", () => {
    const onClose = vi.fn();
    render(<ShareDialog url="http://localhost/share/abc123" onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
