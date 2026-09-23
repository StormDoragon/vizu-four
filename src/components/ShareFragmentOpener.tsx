"use client";

import { useSyncExternalStore } from "react";
import { ShareOpener } from "./ShareOpener";
import { tokenFromHash } from "@/lib/share";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Opens a `/share#<token>` link. The fragment exists only in the browser -
 * that is the point of putting the token there (see buildShareUrl) - so the
 * server-rendered pass has no token and shows the loading state until
 * hydration reads it. A different link pasted over this one only changes
 * the hash, which doesn't navigate, so the opener is keyed on the token to
 * start over from scratch instead of showing the previous link's session.
 */
export function ShareFragmentOpener() {
  const token = useSyncExternalStore(
    subscribe,
    () => tokenFromHash(window.location.hash),
    () => null
  );

  if (token === null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-ink-500">
        Opening shared session…
      </div>
    );
  }
  return <ShareOpener key={token} token={token} />;
}
