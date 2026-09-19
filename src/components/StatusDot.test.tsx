// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "./StatusDot";

describe("StatusDot", () => {
  it("renders a filled dot for a status that has happened", () => {
    render(<StatusDot status="success" />);
    const dot = screen.getByTitle("success");
    expect(dot.className).toContain("bg-status-success");
    expect(dot.className).not.toContain("border-2");
  });

  it("renders a hollow ring for a status that hasn't started yet", () => {
    render(<StatusDot status="pending" />);
    const dot = screen.getByTitle("pending");
    expect(dot.className).toContain("border-2");
    expect(dot.className).toContain("border-status-pending");
    expect(dot.className).not.toContain("bg-status-pending");
  });

  it("overrides everything with a spinning ring when executing, regardless of the underlying status", () => {
    render(<StatusDot status="pending" executing />);
    const dot = screen.getByTitle("running");
    expect(dot.className).toContain("animate-spin");
    expect(dot.className).toContain("border-t-transparent");
  });

  it("falls back to the pending style for an unknown status instead of throwing", () => {
    render(<StatusDot status={undefined} />);
    expect(screen.getByTitle("pending")).toBeInTheDocument();
  });

  it("gives success and failure visually distinct classes, not just different words", () => {
    const { rerender } = render(<StatusDot status="success" />);
    const successClass = screen.getByTitle("success").className;
    rerender(<StatusDot status="failure" />);
    const failureClass = screen.getByTitle("failure").className;
    expect(successClass).not.toBe(failureClass);
  });
});
