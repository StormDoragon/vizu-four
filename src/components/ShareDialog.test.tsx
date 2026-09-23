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

    render(<ShareDialog url="http://localhost/share#abc123" onClose={vi.fn()} />);

    expect(screen.getByTestId("share-url")).toHaveValue("http://localhost/share#abc123");
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith("http://localhost/share#abc123");
    await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument());
  });

  it("calls onClose when dismissed", () => {
    const onClose = vi.fn();
    render(<ShareDialog url="http://localhost/share#abc123" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says the link carries the session readably, not just a pointer to it", () => {
    render(<ShareDialog url="http://localhost/share#abc123" onClose={vi.fn()} />);
    const disclosure = screen.getByTestId("share-disclosure");
    expect(disclosure).toHaveTextContent(/encoded, not encrypted/);
    expect(disclosure).toHaveTextContent(/anyone who gets it can read all of it/);
    expect(disclosure).toHaveTextContent(/can't be revoked/);
  });

  it("does not close when clicking inside the dialog content", () => {
    const onClose = vi.fn();
    render(<ShareDialog url="http://localhost/share#abc123" onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
