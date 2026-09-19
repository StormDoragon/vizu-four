// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark and shows the moon glyph", () => {
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle")).toHaveTextContent("☾");
  });

  it("picks up a stored light preference on mount", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle")).toHaveTextContent("☀");
  });

  it("toggles the data-theme attribute and persists the choice", () => {
    render(<ThemeToggle />);
    const button = screen.getByTestId("theme-toggle");

    fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button).toHaveTextContent("☀");

    fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button).toHaveTextContent("☾");
  });
});
