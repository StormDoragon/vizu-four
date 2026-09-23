"use client";

import { useState } from "react";

export function ShareDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable or blocked (permissions, insecure
      // context) - the link is still right there in a selectable input.
    }
  }

  return (
    <div
      onClick={onClose}
      data-testid="share-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Share this session"
        className="w-full max-w-lg rounded-lg border border-bg-border bg-bg-panel p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Share this session</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-500 hover:text-ink-200">
            ✕
          </button>
        </div>
        <p className="mb-2 text-xs text-ink-500">
          Anyone with this link gets their own independent copy of the workflow, breakpoints,
          mocked step outputs, and What-If env/var overrides — opened at the same step you&apos;re
          on now. <strong className="text-ink-400">Secret values are never included</strong> — if
          you set any, the recipient re-enters them in their own What-If tab.
        </p>
        <p
          data-testid="share-disclosure"
          className="mb-3 rounded-md border border-status-breakpoint/40 bg-status-breakpoint/10 p-2 text-xs text-ink-300"
        >
          <strong className="text-ink-200">The link is the data.</strong> Everything above is
          encoded into the link itself — encoded, not encrypted — so anyone who gets it can read
          all of it, and it can&apos;t be revoked. It sits after the <code>#</code>, which browsers
          don&apos;t send to a server, but it stays in browser history and wherever the link is
          pasted. Take anything sensitive out of env/var overrides and mocks before sharing.
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            data-testid="share-url"
            onFocus={(e) => e.target.select()}
            className="flex-1 rounded-md border border-bg-border bg-bg-raised px-2 py-1.5 font-mono text-xs text-ink-200 focus:outline-none"
          />
          <button
            onClick={copy}
            className="shrink-0 rounded-md bg-status-running px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
