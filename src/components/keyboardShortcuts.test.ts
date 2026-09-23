import { describe, expect, it } from "vitest";
import type { SessionView } from "@/lib/engine/serialize";
import {
  SHORTCUTS,
  controlAvailability,
  isTypingTarget,
  resolveShortcut,
  shortcutHint,
} from "./keyboardShortcuts";

/** Only the two fields controlAvailability actually reads. */
function session(laneStatus?: string): SessionView {
  if (!laneStatus) {
    return { activeLaneId: null, lanes: {} } as unknown as SessionView;
  }
  return {
    activeLaneId: "build::default",
    lanes: { "build::default": { status: laneStatus } },
  } as unknown as SessionView;
}

describe("resolveShortcut", () => {
  it("maps the letter bindings to their commands", () => {
    expect(resolveShortcut({ key: "s" })).toBe("step");
    expect(resolveShortcut({ key: "c" })).toBe("continue");
    expect(resolveShortcut({ key: "e" })).toBe("runToEnd");
    expect(resolveShortcut({ key: "a" })).toBe("runAll");
  });

  it("maps the function-key aliases kept for muscle memory", () => {
    expect(resolveShortcut({ key: "F10" })).toBe("step");
    expect(resolveShortcut({ key: "F8" })).toBe("continue");
  });

  it("matches letters case-insensitively, so Shift or caps lock still works", () => {
    expect(resolveShortcut({ key: "S" })).toBe("step");
    expect(resolveShortcut({ key: "A" })).toBe("runAll");
  });

  it("resolves ? (which needs Shift) to the help toggle", () => {
    expect(resolveShortcut({ key: "?" })).toBe("toggleHelp");
  });

  it("ignores anything held with Ctrl/Cmd/Alt so browser shortcuts still work", () => {
    // Without this, `a` for "run all" would swallow Cmd+A / Ctrl+A.
    expect(resolveShortcut({ key: "a", metaKey: true })).toBeNull();
    expect(resolveShortcut({ key: "a", ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: "s", altKey: true })).toBeNull();
  });

  it("ignores keys pressed while typing in a field", () => {
    expect(resolveShortcut({ key: "s", target: { tagName: "INPUT" } })).toBeNull();
    expect(resolveShortcut({ key: "s", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(resolveShortcut({ key: "s", target: { tagName: "SELECT" } })).toBeNull();
    expect(
      resolveShortcut({ key: "s", target: { tagName: "DIV", isContentEditable: true } })
    ).toBeNull();
  });

  it("still fires from non-typing elements", () => {
    expect(resolveShortcut({ key: "s", target: { tagName: "DIV" } })).toBe("step");
    expect(resolveShortcut({ key: "s", target: { tagName: "BUTTON" } })).toBe("step");
  });

  it("returns null for unbound keys", () => {
    expect(resolveShortcut({ key: "z" })).toBeNull();
    expect(resolveShortcut({ key: "Enter" })).toBeNull();
    expect(resolveShortcut({ key: "F5" })).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("handles a missing or non-element target", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget("not an element")).toBe(false);
  });

  it("is case-insensitive about tag names", () => {
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });
});

describe("controlAvailability", () => {
  it("enables everything for a ready lane that isn't busy", () => {
    expect(controlAvailability(session("ready"), false)).toEqual({
      step: true,
      continue: true,
      runToEnd: true,
      runAll: true,
    });
  });

  it("disables every control while a run is in flight", () => {
    expect(controlAvailability(session("ready"), true)).toEqual({
      step: false,
      continue: false,
      runToEnd: false,
      runAll: false,
    });
  });

  it("disables every control on a shared session awaiting execution consent", () => {
    // The engine refuses every control path until the visitor consents, so a
    // button (or shortcut) that fired one would only surface that refusal as
    // an error banner - which is exactly what this function exists to avoid.
    const awaiting = {
      activeLaneId: "build::default",
      lanes: { "build::default": { status: "ready" } },
      awaitingExecutionConsent: true,
    } as unknown as SessionView;
    expect(controlAvailability(awaiting, false)).toEqual({
      step: false,
      continue: false,
      runToEnd: false,
      runAll: false,
    });
  });

  it("disables stepping on a lane still blocked on needs, but allows Run all", () => {
    const can = controlAvailability(session("blocked"), false);
    expect(can.step).toBe(false);
    expect(can.runAll).toBe(true);
  });

  it.each(["success", "failure", "skipped", "cancelled"])(
    "disables stepping once the lane is %s",
    (status) => {
      const can = controlAvailability(session(status), false);
      expect(can.step).toBe(false);
      expect(can.continue).toBe(false);
      expect(can.runToEnd).toBe(false);
      expect(can.runAll).toBe(true);
    }
  );

  it("disables stepping when there is no active lane at all", () => {
    const can = controlAvailability(session(), false);
    expect(can.step).toBe(false);
    expect(can.runAll).toBe(true);
  });
});

describe("SHORTCUTS table", () => {
  it("binds each key to exactly one command", () => {
    const keys = SHORTCUTS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("formats a tooltip hint from every binding for a command", () => {
    expect(shortcutHint("step")).toBe("S or F10");
    expect(shortcutHint("runToEnd")).toBe("E");
  });
});
