// Checks for CSV export and the notification seam.
//
// The escaping matters more than it looks: PRF descriptions routinely contain commas, quotes and
// newlines, and a vendor name beginning with "-" or "=" is treated as a formula by Excel and Sheets.
//
//   node design-system/test/export-notify.mjs

import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = path.join(here, ".exp-tmp");
await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(tmp, { recursive: true });

const outfile = path.join(tmp, "ds.mjs");
await build({
  stdin: { contents: `export * from "./src/index.ts"; export * from "./src/fixtures.ts";`, resolveDir: path.join(here, ".."), loader: "ts" },
  outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"], logOverride: { "ignored-directive": "silent" }, logLevel: "error",
});
const ds = await import(pathToFileURL(outfile).href);

const failures = [];
const check = (name, condition, detail = "") => { if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`); };

// ---- CSV escaping ---------------------------------------------------------------------------------
check("plain value is unquoted", ds.csvField("Northstar") === "Northstar");
check("comma forces quoting", ds.csvField("Kits, robotics") === '"Kits, robotics"');
check("embedded quotes are doubled", ds.csvField('He said "yes"') === '"He said ""yes"""');
check("newline forces quoting", ds.csvField("line one\nline two") === '"line one\nline two"');
check("empty stays empty", ds.csvField("") === "");
check("null becomes empty", ds.csvField(null) === "" && ds.csvField(undefined) === "");
// Formula injection: a cell starting with = + - @ is executed by Excel and Sheets.
for (const dangerous of ["=1+1", "+1", "-Acme", "@SUM(A1)"]) {
  check(`formula guard on ${dangerous}`, ds.csvField(dangerous).replace(/^"|"$/g, "").startsWith("'"), ds.csvField(dangerous));
}

// ---- rows and columns -----------------------------------------------------------------------------
const csv = ds.toCsv(ds.sampleRequests);
const lines = csv.split("\r\n").filter(Boolean);
check("header plus one row per request", lines.length === ds.sampleRequests.length + 1, `${lines.length} lines`);
check("BOM is present for Excel", csv.charCodeAt(0) === 0xfeff);
for (const column of ds.EXPORT_COLUMNS) check(`column "${column}" is in the header`, lines[0].includes(column));
check("every requested export field is present", ds.EXPORT_COLUMNS.length === 12, `${ds.EXPORT_COLUMNS.length} columns`);

const row = ds.exportRow(ds.sampleRequests[0]);
check("row width matches header", row.length === ds.EXPORT_COLUMNS.length);
check("PRF number leads the row", row[0] === "PRF-FY27-0001");
check("grand total is the amount", row[11] === "8425.00", row[11]);
check("line items are flattened into one cell", row[10].includes("|"), row[10]);

// A custom site has no code yet; the export must say so rather than leave a blank.
const custom = { ...ds.sampleRequests[0], siteCode: "", customSite: true };
check("unlisted site is labelled in the export", ds.exportRow(custom)[5] === "UNLISTED", ds.exportRow(custom)[5]);

// Divvy payment type resolves to its human label.
const divvy = { ...ds.sampleRequests[0], paymentType: "divvy" };
check("divvy payment label", ds.exportRow(divvy)[7] === "Divvy Card", ds.exportRow(divvy)[7]);

// ---- filenames ------------------------------------------------------------------------------------
check("filters shape the filename",
  ds.exportFilename({ status: "Approved", site: "Beachy", month: "2026-08" }) === "PRF-export-approved-beachy-2026-08.csv",
  ds.exportFilename({ status: "Approved", site: "Beachy", month: "2026-08" }));
check("bare filename when unfiltered", ds.exportFilename() === "PRF-export.csv", ds.exportFilename());
check("filename is filesystem safe",
  !/[^A-Za-z0-9.\-]/.test(ds.exportFilename({ site: "St. Mary's / Annex #2" })),
  ds.exportFilename({ site: "St. Mary's / Annex #2" }));

// ---- notifications --------------------------------------------------------------------------------
const delivered = [];
ds.setTransport({ name: "test", deliver: n => delivered.push(n) });

const awaiting = ds.sampleRequests.find(r => r.status === "Awaiting Approval");
const submitted = ds.notify("submitted", awaiting);
check("submission is addressed to the approver", submitted.audience === "approver", submitted.audience);
check("approver comes from the amount threshold", submitted.recipient === ds.routeFor(awaiting.amount), submitted.recipient);
check("submission names the PRF", submitted.title.includes(awaiting.id));

const approved = ds.notify("approved", awaiting);
check("approval is addressed to the requester", approved.audience === "requester" && approved.recipient === awaiting.requester);

const returned = ds.notify("returned", awaiting, "Please attach the vendor quote.");
check("returned carries the reviewer note", returned.body.includes("Please attach the vendor quote."), returned.body);

check("transport received every notification", delivered.length === 3, `${delivered.length}`);
check("ids are unique", new Set(delivered.map(n => n.id)).size === 3);

const unread = [submitted, approved, returned];
check("unread count", ds.unreadCount(unread) === 3);
check("markAllRead clears the badge", ds.unreadCount(ds.markAllRead(unread)) === 0);
check("relative time", ds.relativeTime(new Date().toISOString()) === "just now", ds.relativeTime(new Date().toISOString()));
check("relative time hours", ds.relativeTime(new Date(Date.now() - 3 * 3600e3).toISOString()) === "3h ago");

// The default transport must not throw when nothing is installed.
ds.setTransport(ds.noopTransport);
check("no-op transport is safe", Boolean(ds.notify("revision", awaiting)));
check("no-op transport is named", ds.currentTransport().name.includes("no-op"));

await fs.rm(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n  ✗ ${failures.length} export/notify check(s) FAILED\n`);
  failures.forEach(line => console.error(`    ${line}`));
  process.exit(1);
}
console.log(`\n  ✓ export: ${ds.EXPORT_COLUMNS.length} columns, injection-guarded · notifications: audience routing and transport seam\n`);
