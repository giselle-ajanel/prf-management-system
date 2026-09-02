import type { Status } from "../types";

export type StatusPillProps = {
  /** Lifecycle state to display. The pill derives its own colour from this value. */
  status: Status;
};

/**
 * Colour-coded lifecycle badge for a purchase request.
 *
 * The class name is derived from the status text, so the five values map to `.status-draft`,
 * `.status-pending-supervisor-approval`, `.status-pending-finance-review`, `.status-needs-revision` and
 * `.status-approved`.
 *
 * ```tsx
 * <StatusPill status="Pending Finance Review" />
 * ```
 */
export function StatusPill({ status }: StatusPillProps) {
  return <span className={`status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>;
}
