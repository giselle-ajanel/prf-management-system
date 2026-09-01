"use client";

import type { Request } from "../types";
import { downloadCsv, exportFilename, toCsv } from "../export";

export type ExportButtonProps = {
  /** The rows to export — pass the filtered view, not the full register. */
  requests: Request[];
  /** Filters that produced this view. Used only to name the file. */
  filters?: { status?: string; site?: string; month?: string };
  label?: string;
  /** Base name for the downloaded file. */
  prefix?: string;
  className?: string;
};

/**
 * Downloads the current view as CSV.
 *
 * Whatever is passed in is what gets exported, so the button inherits the page's filters — a Finance
 * register narrowed to Approved PRFs for one site in one month exports exactly those rows. The file name
 * records the filters so several exports stay distinguishable.
 *
 * Disabled with a count of zero, since an empty download looks like a broken button.
 *
 * ```tsx
 * <ExportButton requests={filtered} filters={{ status: filters.status, site: filters.school, month: filters.month }} />
 * ```
 */
export function ExportButton({
  requests,
  filters = {},
  label = "Export to CSV",
  prefix,
  className = "secondary",
}: ExportButtonProps) {
  const count = requests.length;
  return (
    <button
      type="button"
      className={`exportButton ${className}`.trim()}
      disabled={!count}
      title={count ? `Export ${count} PRF${count === 1 ? "" : "s"} as CSV` : "Nothing to export in this view"}
      onClick={() => downloadCsv(toCsv(requests), exportFilename({ ...filters, prefix }))}
    >
      ⤓ {label}
      {count ? <span className="exportCount">{count}</span> : null}
    </button>
  );
}
