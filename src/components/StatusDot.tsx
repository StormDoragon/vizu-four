"use client";

import { statusStyle } from "./statusStyles";

/**
 * The one place a bare status turns into a small circular marker - used by
 * JobNode for both the per-job lane dot and the per-step dot. Centralized
 * so the graph's dots and the executing-now animation can't drift from the
 * shared color/glyph mapping in statusStyles.ts.
 */
export function StatusDot({
  status,
  executing = false,
  size = "sm",
  className = "",
}: {
  status: string | undefined;
  /** True for the one step actually in flight right now (a control
   * request is in-flight and this is the lane's live cursor). Overrides
   * the plain dot with a spinning ring - the client-driven, always-
   * observable substitute for a server "running" status, which in this
   * synchronous request/response engine never actually reaches the
   * browser (the whole control call resolves before any response is
   * sent, so "running" is set and cleared entirely server-side). */
  executing?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const style = statusStyle(status);
  const dim = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";

  if (executing) {
    return (
      <span
        role="status"
        aria-label="running"
        title="running"
        className={`${dim} shrink-0 animate-spin rounded-full border-2 border-t-transparent ${style.ringClass} ${className}`}
      />
    );
  }

  if (style.hollow) {
    return (
      <span
        aria-label={style.label}
        title={style.label}
        className={`${dim} shrink-0 rounded-full border-2 ${style.ringClass} ${className}`}
      />
    );
  }

  return (
    <span
      aria-label={style.label}
      title={style.label}
      className={`${dim} shrink-0 rounded-full ${style.dotClass} ${className}`}
    />
  );
}
