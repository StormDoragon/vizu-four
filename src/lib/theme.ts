export type Theme = "dark" | "light";

/** Dark is the app's original, unchanged default - a first-time visitor
 * (no stored preference) sees exactly what they always have. */
export const DEFAULT_THEME: Theme = "dark";

export const THEME_STORAGE_KEY = "vizu-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

/** Reads the persisted theme choice. Returns null (never throws) if
 * nothing's stored, storage is unavailable (private browsing, disabled),
 * or the caller passed no storage at all (e.g. server-side). */
export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined | null): Theme | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persists a theme choice. Silently no-ops on failure - the toggle still
 * takes effect for this page load, it just won't be remembered next time. */
export function writeStoredTheme(theme: Theme, storage: Pick<Storage, "setItem"> | undefined | null): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // See doc comment above.
  }
}

export function applyThemeAttribute(theme: Theme, root: Pick<Element, "setAttribute">): void {
  root.setAttribute("data-theme", theme);
}

/**
 * Runs synchronously in <head>, before React hydrates or any stylesheet
 * paints, so a returning visitor's light-mode preference never flashes
 * dark-then-light. Necessarily a standalone string (it has to execute
 * before this module's own JS bundle loads) - kept intentionally tiny and
 * mirroring readStoredTheme/applyThemeAttribute's logic exactly, rather
 * than duplicating any decision this file doesn't already make.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(t!=="light"&&t!=="dark")return;document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;
