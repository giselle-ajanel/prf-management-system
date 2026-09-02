"use client";

import type { Request, Status } from "../types";
import { money } from "../utils";
import { ExportButton } from "./ExportButton";
import { PageHead } from "./PageHead";
import { PrfNumber } from "./PrfNumber";
import { StatusPill } from "./StatusPill";
import { DEFAULT_MONTHS, type MonthOption } from "./MonthFilter";

/** The six filters the finance register supports. All are `""` when unset. */
export type FinanceFilters = {
  query: string;
  month: string;
  district: string;
  school: string;
  status: string;
  funding: string;
};

export type FinanceProps = {
  /**
   * Whether this viewer may take the register away as a file. False for every read-only account except an
   * auditor — reading the register on screen and walking out with it are different acts.
   */
  canExport?: boolean;
  /** Rows to display — the caller applies `filters` before passing them in. */
  requests: Request[];
  /** Every request, filtered or not. Drives the three metric tiles and the funding dropdown. */
  all: Request[];
  filters: FinanceFilters;
  setFilters: (filters: FinanceFilters) => void;
  onOpen: (request: Request) => void;
  /**
   * District → schools map backing the two location filters.
   *
   * This was a module-level constant in the original Hub. It is a prop here because the register is not
   * specific to one organisation's district list, and because a component that closes over app data cannot
   * be rendered in isolation.
   */
  districts: Record<string, string[]>;
  /** Approval-month options. Defaults to the three the Hub shipped with. */
  months?: MonthOption[];
  /** Selectable statuses. Defaults to all four lifecycle states. */
  statuses?: Status[];
};

const DEFAULT_STATUSES: Status[] = ["Draft", "Pending Supervisor Approval", "Pending Finance Review", "Needs Revision", "Approved"];

/**
 * Finance register: three metric tiles, a six-field filter bar, and a District → School → PRF table.
 *
 * The school dropdown narrows to the selected district, and choosing a district clears any school already
 * selected so the two can never disagree.
 *
 * ```tsx
 * <Finance
 *   requests={filtered}
 *   all={requests}
 *   filters={filters}
 *   setFilters={setFilters}
 *   onOpen={setSelected}
 *   districts={districts}
 * />
 * ```
 */
export function Finance({
  requests,
  all,
  filters,
  setFilters,
  onOpen,
  districts,
  months = DEFAULT_MONTHS,
  statuses = DEFAULT_STATUSES,
  canExport = true,
}: FinanceProps) {
  const schools = filters.district ? districts[filters.district] : Object.values(districts).flat();
  const cleared = all.filter(r => r.status === "Approved").reduce((s, r) => s + r.amount, 0);
  return (
    <section className="page financePage">
      <PageHead
        eyebrow="Finance & Accounting"
        title="Finance Command Center"
        copy="District → School → Individual PRF. Search every cycle from one controlled register."
        action={
          canExport ? (
            <ExportButton
              requests={requests}
              filters={{ status: filters.status, site: filters.school || filters.district, month: filters.month }}
              prefix="PRF-finance"
            />
          ) : undefined
        }
      />
      <div className="financeMetrics">
        <article>
          <small>Total requested</small>
          <strong>{money(all.reduce((s, r) => s + r.amount, 0))}</strong>
          <span>Across {new Set(all.map(r => r.district)).size} districts</span>
        </article>
        <article>
          <small>Pending approvals</small>
          <strong>{all.filter(r => r.status === "Pending Supervisor Approval" || r.status === "Pending Finance Review").length}</strong>
          <span>Requires action</span>
        </article>
        <article>
          <small>Cleared total</small>
          <strong>{money(cleared)}</strong>
          <span>Approved this fiscal year</span>
        </article>
      </div>
      <div className="filters">
        <label>
          Search
          <input
            value={filters.query}
            onChange={e => setFilters({ ...filters, query: e.target.value })}
            placeholder="PRF, vendor, or description"
          />
        </label>
        <label>
          Calendar month / year
          <select value={filters.month} onChange={e => setFilters({ ...filters, month: e.target.value })}>
            <option value="">All approval months</option>
            {months.map(month => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          District
          <select
            value={filters.district}
            onChange={e => setFilters({ ...filters, district: e.target.value, school: "" })}
          >
            <option value="">All districts</option>
            {Object.keys(districts).map(d => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          School
          <select value={filters.school} onChange={e => setFilters({ ...filters, school: e.target.value })}>
            <option value="">All schools</option>
            {schools.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            {statuses.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Funding
          <select value={filters.funding} onChange={e => setFilters({ ...filters, funding: e.target.value })}>
            <option value="">All funding</option>
            {[...new Set(all.map(r => r.fundingCode))].map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="hierarchy">
        <div className="hierarchyHead">
          <span>{filters.district || "All districts"}</span>
          <b>›</b>
          <span>{filters.school || "All schools"}</span>
          <b>›</b>
          <strong>{requests.length} PRFs</strong>
        </div>
        <div className="tableWrap">
          <table className="financeTable">
            <thead>
              <tr>
                <th>PRF</th>
                <th>District / School</th>
                <th>Vendor</th>
                <th>Funding</th>
                <th>Status</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id}>
                  <td>
                    <PrfNumber id={r.id} paymentType={r.paymentType} />
                    <small>{r.cycle}</small>
                  </td>
                  <td>
                    {r.district}
                    <small>{r.school}</small>
                  </td>
                  <td>{r.vendor}</td>
                  <td>{r.fundingCode}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td>
                    <strong>{money(r.amount)}</strong>
                  </td>
                  <td>
                    <button className="iconButton" onClick={() => onOpen(r)} aria-label={`Open ${r.id}`}>
                      ›
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!requests.length && <div className="empty">No PRFs match these filters.</div>}
      </div>
    </section>
  );
}
