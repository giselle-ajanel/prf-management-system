import type { Request } from "../types";
import { currentMonth, money } from "../utils";
import { StatCard } from "./StatCard";

export type SummaryProps = {
  /** Requests to summarise — normally the signed-in user's own. */
  requests: Request[];
  /**
   * `YYYY-MM` key used for the "approved this month" tile. Defaults to the current month.
   * Pass an explicit month to make the output deterministic (previews, tests, fixed reporting periods).
   */
  month?: string;
};

/**
 * Four-tile stat band: open drafts, awaiting approval, approved count, and this month's approved total.
 *
 * Sits directly beneath the hero with a negative top margin, so it overlaps the section above by design.
 *
 * ```tsx
 * <Summary requests={mine} />
 * ```
 */
export function Summary({ requests, month = currentMonth() }: SummaryProps) {
  const drafts = requests.filter(r => r.status === "Draft").length,
    pending = requests.filter(r => ["Awaiting Approval"].includes(r.status)).length,
    approved = requests.filter(r => r.status === "Approved"),
    thisMonth = approved.filter(r => r.approvedAt?.startsWith(month));
  return (
    <section className="summary">
      <StatCard tone="coral" icon="✎" value={drafts} label="Open drafts" note="Saved automatically on this device" />
      <StatCard tone="yellow" icon="↗" value={pending} label="Awaiting approval" note="Smart routed by total" />
      <StatCard
        tone="mint"
        icon="✓"
        value={approved.length}
        label="Approved requests"
        note={`${money(approved.reduce((s, r) => s + r.amount, 0))} cleared`}
      />
      <StatCard
        tone="blue"
        icon="▣"
        value={money(thisMonth.reduce((s, r) => s + r.amount, 0))}
        label="Total approved this month"
        note={
          <>
            {thisMonth.length} approved PRF{thisMonth.length === 1 ? "" : "s"}
          </>
        }
      />
    </section>
  );
}
