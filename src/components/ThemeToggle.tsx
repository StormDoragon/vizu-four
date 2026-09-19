"use client";

import { useEffect, useState } from "react";
import { applyThemeAttribute, DEFAULT_THEME, readStoredTheme, writeStoredTheme, type Theme } from "@/lib/theme";

/** Starts at the SSR-safe default and syncs to the real stored value in an
 * effect - avoids a hydration mismatch, since the server can't know what's
 * in the visitor's localStorage. The inline script in layout.tsx (which
 * runs before hydration) already applied the right `data-theme`, so this
 * only has to catch up the toggle's own displayed state. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    // Only localStorage (unavailable during SSR) can say whether the real
    // preference differs from the default - not derived state, so it can't
    // move to render.
    const stored = readStoredTheme(window.localStorage);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setTheme(stored);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyThemeAttribute(next, document.documentElement);
    writeStoredTheme(next, window.localStorage);
  }

  return (
    <button
      onClick={toggle}
      data-testid="theme-toggle"
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-md border border-bg-border bg-bg-raised px-2 py-1.5 text-xs font-medium text-ink-400 hover:border-status-running hover:text-ink-100"
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
