import type { Status } from "../types";

export type StatusPillProps = {
  /** Lifecycle state to display. The pill derives its own colour from this value. */
  status: Status;
};

/**
 * Colour-coded lifecycle badge for a purchase request.
 *
 * The class name is derived from the status text, so the four supported values map to
 * `.status-draft`, `.status-awaiting-approval`, `.status-returned` and `.status-approved`.
 *
 * ```tsx
 * <StatusPill status="Awaiting Approval" />
 * ```
 */
export function StatusPill({ status }: StatusPillProps) {
  return <span className={`status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>;
}
