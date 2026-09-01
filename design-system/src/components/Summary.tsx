import type { Request } from "../types";
import { currentMonth, money } from "../utils";

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
      <article>
        <span className="statIcon coral">✎</span>
        <div>
          <strong>{drafts}</strong>
          <p>Open drafts</p>
          <small>Saved automatically on this device</small>
        </div>
      </article>
      <article>
        <span className="statIcon yellow">↗</span>
        <div>
          <strong>{pending}</strong>
          <p>Awaiting approval</p>
          <small>Smart routed by total</small>
        </div>
      </article>
      <article>
        <span className="statIcon mint">✓</span>
        <div>
          <strong>{approved.length}</strong>
          <p>Approved requests</p>
          <small>{money(approved.reduce((s, r) => s + r.amount, 0))} cleared</small>
        </div>
      </article>
      <article>
        <span className="statIcon blue">▣</span>
        <div>
          <strong>{money(thisMonth.reduce((s, r) => s + r.amount, 0))}</strong>
          <p>Total approved this month</p>
          <small>
            {thisMonth.length} approved PRF{thisMonth.length === 1 ? "" : "s"}
          </small>
        </div>
      </article>
    </section>
  );
}
