import { describe, expect, it, vi } from "vitest";
import {
  applyThemeAttribute,
  isTheme,
  readStoredTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  writeStoredTheme,
} from "./theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    _data: data,
  };
}

describe("isTheme", () => {
  it("accepts only the two known values", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe("readStoredTheme", () => {
  it("returns the stored theme when it's valid", () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: "light" });
    expect(readStoredTheme(storage)).toBe("light");
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredTheme(fakeStorage())).toBe(null);
  });

  it("returns null for a garbage/legacy value instead of throwing", () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: "sepia" });
    expect(readStoredTheme(storage)).toBe(null);
  });

  it("returns null when storage is unavailable (no throw)", () => {
    expect(readStoredTheme(undefined)).toBe(null);
    expect(readStoredTheme(null)).toBe(null);
  });

  it("returns null instead of throwing when storage.getItem itself throws (private browsing)", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredTheme(storage)).toBe(null);
  });
});

describe("writeStoredTheme", () => {
  it("persists the theme", () => {
    const storage = fakeStorage();
    writeStoredTheme("light", storage);
    expect(storage._data[THEME_STORAGE_KEY]).toBe("light");
  });

  it("does not throw when storage.setItem throws (quota, private browsing)", () => {
    const storage = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => writeStoredTheme("dark", storage)).not.toThrow();
  });

  it("does not throw when storage is unavailable", () => {
    expect(() => writeStoredTheme("dark", undefined)).not.toThrow();
  });
});

describe("applyThemeAttribute", () => {
  it("sets data-theme to the given theme", () => {
    const setAttribute = vi.fn();
    applyThemeAttribute("light", { setAttribute });
    expect(setAttribute).toHaveBeenCalledWith("data-theme", "light");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  it("only ever sets data-theme to a value it would itself accept as valid", () => {
    // The inline string can't import isTheme (it has to run standalone,
    // before this module's own bundle loads) - this test is the guard
    // against the two independently-maintained checks drifting apart.
    expect(THEME_INIT_SCRIPT).toContain('t!=="light"&&t!=="dark"');
  });

  it("reads from the same storage key the rest of this module uses", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("is wrapped in a try/catch, so a blocked localStorage can't break the page", () => {
    expect(THEME_INIT_SCRIPT).toMatch(/^\(function\(\)\{try\{/);
    expect(THEME_INIT_SCRIPT).toContain("catch(e){}");
  });
});
