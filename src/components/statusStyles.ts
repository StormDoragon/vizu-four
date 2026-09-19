/**
 * The single source of truth for status → color/glyph mapping, shared by
 * the graph (JobNode), the matrix tab (MatrixExplorer), and the step list
 * (StepDetailPanel). Before this, each of the three kept its own hand-
 * copied `Record<string, string>` - functionally similar today, but with
 * nothing to stop them drifting apart, which is exactly what "distinct,
 * accessible colors... consistent across graph, matrix tab, and step
 * list" (#11) asks to close off structurally rather than just re-align by
 * eye once.
 *
 * Every status also carries a `glyph` - a non-color signal (WCAG 1.4.1:
 * color must never be the only way information is conveyed). Text labels
 * (MatrixExplorer's badge, StepDetailPanel's status word) already satisfy
 * this on their own; the glyph exists for the one place that didn't - the
 * plain colored dots in the graph - and doubles as a quick-glance aid for
 * everyone, not only colorblind users.
 */

export type StatusKind =
  | "pending"
  | "ready"
  | "blocked"
  | "running"
  | "paused"
  | "success"
  | "failure"
  | "skipped"
  | "cancelled";

export interface StatusStyle {
  /** Filled-circle background class, for a solid dot. */
  dotClass: string;
  /** Border class for a hollow (outline-only) dot - used for states that
   * haven't happened yet, so "not started" reads as visually empty rather
   * than as a fifth flavor of filled circle. */
  ringClass: string;
  /** Text color class. */
  textClass: string;
  /** Combined bg+text classes for a pill/badge. */
  badgeClass: string;
  /** True when this status should render as a hollow ring rather than a
   * filled dot (currently just "pending"/"ready"/"blocked" - nothing has
   * happened yet). */
  hollow: boolean;
  /** A short, non-color glyph redundantly encoding the same status. */
  glyph: string;
  /** Human label, for anywhere a word is more useful than a dot. */
  label: string;
}

const STYLES: Record<StatusKind, StatusStyle> = {
  pending: {
    dotClass: "bg-status-pending",
    ringClass: "border-status-pending",
    textClass: "text-status-pending",
    badgeClass: "bg-status-pending/20 text-status-pending",
    hollow: true,
    glyph: "○",
    label: "pending",
  },
  ready: {
    dotClass: "bg-status-pending",
    ringClass: "border-status-pending",
    textClass: "text-status-pending",
    badgeClass: "bg-status-pending/20 text-status-pending",
    hollow: true,
    glyph: "○",
    label: "ready",
  },
  blocked: {
    dotClass: "bg-status-pending",
    ringClass: "border-status-pending",
    textClass: "text-status-pending",
    badgeClass: "bg-status-pending/20 text-status-pending",
    hollow: true,
    glyph: "◌",
    label: "blocked",
  },
  running: {
    dotClass: "bg-status-running",
    ringClass: "border-status-running",
    textClass: "text-status-running",
    badgeClass: "bg-status-running/20 text-status-running",
    hollow: false,
    glyph: "▶",
    label: "running",
  },
  paused: {
    dotClass: "bg-status-breakpoint",
    ringClass: "border-status-breakpoint",
    textClass: "text-status-breakpoint",
    badgeClass: "bg-status-breakpoint/20 text-status-breakpoint",
    hollow: false,
    glyph: "❚❚",
    label: "paused",
  },
  success: {
    dotClass: "bg-status-success",
    ringClass: "border-status-success",
    textClass: "text-status-success",
    badgeClass: "bg-status-success/20 text-status-success",
    hollow: false,
    glyph: "✓",
    label: "success",
  },
  failure: {
    dotClass: "bg-status-failure",
    ringClass: "border-status-failure",
    textClass: "text-status-failure",
    badgeClass: "bg-status-failure/20 text-status-failure",
    hollow: false,
    glyph: "✕",
    label: "failure",
  },
  skipped: {
    dotClass: "bg-status-skipped",
    ringClass: "border-status-skipped",
    textClass: "text-status-skipped",
    badgeClass: "bg-status-skipped/20 text-status-skipped",
    hollow: false,
    glyph: "–",
    label: "skipped",
  },
  cancelled: {
    // Visually grouped with "skipped" - both mean "this didn't run, and
    // it's not a failure" - but keeps its own label/glyph since *why* it
    // didn't run is worth being able to tell apart on hover.
    dotClass: "bg-status-skipped",
    ringClass: "border-status-skipped",
    textClass: "text-status-skipped",
    badgeClass: "bg-status-skipped/20 text-status-skipped",
    hollow: false,
    glyph: "⊘",
    label: "cancelled",
  },
};

/** Resolves a status style, falling back to "pending" for anything unknown
 * (e.g. a status value that predates a future new lane/step state) rather
 * than rendering unstyled. */
export function statusStyle(status: string | undefined): StatusStyle {
  return STYLES[status as StatusKind] ?? STYLES.pending;
}
