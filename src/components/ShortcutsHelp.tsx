"use client";

import { SHORTCUTS } from "./keyboardShortcuts";

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      data-testid="shortcuts-help"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-sm rounded-lg border border-bg-border bg-bg-panel p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="text-ink-500 hover:text-ink-200"
          >
            ✕
          </button>
        </div>
        <dl className="space-y-1.5">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.command} className="flex items-center justify-between gap-4">
              <dt className="text-xs text-ink-300">{shortcut.label}</dt>
              <dd className="flex shrink-0 gap-1">
                {shortcut.hints.map((hint) => (
                  <kbd
                    key={hint}
                    className="rounded border border-bg-border bg-bg-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-200"
                  >
                    {hint}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-bg-border pt-2 text-[11px] text-ink-500">
          Shortcuts are ignored while typing in a field, and when a control is
          unavailable (no active lane, lane finished, or a run in progress).
        </p>
      </div>
    </div>
  );
}
