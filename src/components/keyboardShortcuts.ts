import type { ControlAction } from "@/lib/apiClient";
import type { SessionView } from "@/lib/engine/serialize";

const TERMINAL = new Set(["success", "failure", "skipped", "cancelled"]);

export type ShortcutCommand = ControlAction | "toggleHelp";

export interface Shortcut {
  command: ShortcutCommand;
  /** Every `KeyboardEvent.key` that triggers this command (letters lowercased). */
  keys: string[];
  /** How the keys are written in the UI; the first is what button tooltips show. */
  hints: string[];
  label: string;
}

/**
 * Single source of truth for both the resolver and the help overlay, so the
 * two can't drift apart.
 *
 * Letters are the primary binding rather than the classic debugger F-keys:
 * F5 is browser reload and F11 is fullscreen (hijacking either is hostile),
 * and on Mac laptops function keys need Fn by default. F10/F8 are kept as
 * aliases for muscle memory since they're free in browsers.
 */
export const SHORTCUTS: Shortcut[] = [
  { command: "step", keys: ["s", "F10"], hints: ["S", "F10"], label: "Step" },
  { command: "continue", keys: ["c", "F8"], hints: ["C", "F8"], label: "Continue" },
  { command: "runToEnd", keys: ["e"], hints: ["E"], label: "Run to end" },
  { command: "runAll", keys: ["a"], hints: ["A"], label: "Run all" },
  { command: "toggleHelp", keys: ["?"], hints: ["?"], label: "Toggle this help" },
];

/** Duck-typed rather than DOM-typed so the guard is unit-testable without a
 * DOM, while still accepting a real `KeyboardEvent`. */
export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

/** True for anything the user could be typing into - the What-If key/value
 * rows, the expression playground, the mock-outputs editor, the workflow
 * textarea. A bare letter shortcut must never fire from inside one. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : undefined;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable === true;
}

/**
 * Maps a keydown to a command, or null if it isn't one of ours.
 *
 * Ctrl/Cmd/Alt combinations are always rejected so the browser's own
 * shortcuts still work - without that, `A` for "run all" would swallow
 * Cmd+A/Ctrl+A. Shift is allowed, because `?` requires it.
 */
export function resolveShortcut(event: KeyEventLike): ShortcutCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return SHORTCUTS.find((s) => s.keys.includes(key))?.command ?? null;
}

export type ControlAvailability = Record<ControlAction, boolean>;

/**
 * Which controls are usable right now. Shared by the TopBar buttons and the
 * keyboard handler so a shortcut can never fire an action its button would
 * have had disabled (which would just surface an engine error banner).
 */
export function controlAvailability(session: SessionView, busy: boolean): ControlAvailability {
  // A shared session refuses every control path in the engine until the
  // visitor consents, so nothing is available while it waits - otherwise a
  // button (or its keyboard shortcut) would fire an action that comes
  // straight back as the "hasn't been allowed to run yet" error banner,
  // which is the exact thing this function exists to prevent. The consent
  // banner, not a control, is what moves such a session forward.
  if (session.awaitingExecutionConsent) {
    return { step: false, continue: false, runToEnd: false, runAll: false };
  }
  const lane = session.activeLaneId ? session.lanes[session.activeLaneId] : null;
  const canStep =
    !!lane && !TERMINAL.has(lane.status) && lane.status !== "blocked" && !busy;
  return { step: canStep, continue: canStep, runToEnd: canStep, runAll: !busy };
}

/** Tooltip text for a control button, e.g. "S or F10". */
export function shortcutHint(command: ShortcutCommand): string {
  return SHORTCUTS.find((s) => s.command === command)?.hints.join(" or ") ?? "";
}
