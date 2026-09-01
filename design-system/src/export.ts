// CSV export for the Finance register and the request trail.
//
// CSV rather than .xlsx on purpose: Excel and Sheets both open it natively, it needs no dependency, and it
// keeps working in the single-file standalone build where there is no install step. The escaping below is
// the part that actually matters — PRF descriptions routinely contain commas, quotes and newlines.

import type { Request } from "./types";

/** Columns in the export, in order. */
export const EXPORT_COLUMNS = [
  "PRF #",
  "Submission Date",
  "Status",
  "Requester",
  "Site Name",
  "Site Code",
  "Period Funding Source",
  "Payment Type",
  "Vendor Name",
  "Expense Type",
  "Line Items",
  "Grand Total",
] as const;

/** Human labels for the stored payment type keys. */
export const PAYMENT_LABELS: Record<string, string> = {
  divvy: "Divvy Card",
  systems: "Systems Dept",
  direct: "Direct Vendor (Check Request or ePay)",
};

/**
 * Escapes one CSV field.
 *
 * Quotes the value when it contains a delimiter, a quote or a newline, and doubles any embedded quotes.
 * A leading =, +, - or @ is prefixed with a single quote: spreadsheet software otherwise treats such a
 * value as a formula, which turns a vendor name like "-Acme" into a broken cell and is the mechanism
 * behind CSV injection.
 */
export function csvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Flattens a request's line items into one cell. */
export const lineItemsCell = (request: Request) =>
  request.lineItems
    .map(line => {
      const total = line.quantity > 1 ? line.quantity * line.unitPrice : line.unitPrice;
      return `${line.description} — ${total.toFixed(2)}`;
    })
    .join(" | ");

/** The submission date, falling back to approval date, then to the display timestamp. */
export const submissionDate = (request: Request) => {
  const iso = request.submittedAt || request.approvedAt;
  return iso ? iso.slice(0, 10) : request.updated || "";
};

/** One export row, aligned with {@link EXPORT_COLUMNS}. */
export function exportRow(request: Request): string[] {
  return [
    request.id,
    submissionDate(request),
    request.status,
    request.requester,
    request.school,
    request.siteCode || (request.customSite ? "UNLISTED" : ""),
    request.fundingCode,
    PAYMENT_LABELS[request.paymentType || ""] || request.paymentType || "",
    request.vendor,
    request.expenseType || "",
    lineItemsCell(request),
    request.amount.toFixed(2),
  ];
}

/**
 * Renders requests as CSV text.
 *
 * A UTF-8 BOM is prepended so Excel on Windows reads the site names correctly — without it, names
 * containing non-ASCII characters arrive mojibaked.
 */
export function toCsv(requests: Request[], columns: readonly string[] = EXPORT_COLUMNS): string {
  const header = columns.map(csvField).join(",");
  const rows = requests.map(request => exportRow(request).map(csvField).join(","));
  return `﻿${[header, ...rows].join("\r\n")}\r\n`;
}

/**
 * Builds a descriptive file name from the filters that produced the export.
 *
 * "PRF-export-approved-beachy-2026-08.csv" beats "export.csv" when Finance is reconciling several sites.
 */
export function exportFilename(parts: { status?: string; site?: string; month?: string; prefix?: string } = {}) {
  // Filter values are lowercased so the name reads evenly; the prefix keeps its case, since it is ours
  // and "PRF-export-approved-beachy" scans better than "prf-export-approved-beachy".
  const slug = (value: string, lower = true) => {
    const cleaned = value.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return lower ? cleaned.toLowerCase() : cleaned;
  };
  const prefix = slug(parts.prefix || "PRF-export", false);
  const pieces = [parts.status, parts.site, parts.month]
    .filter((piece): piece is string => Boolean(piece && piece.trim()))
    .map(piece => slug(piece))
    .filter(Boolean);
  return `${[prefix, ...pieces].filter(Boolean).join("-") || "PRF-export"}.csv`;
}

/** Triggers a browser download of `content`. No-op outside a browser. */
export function downloadCsv(content: string, filename: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
