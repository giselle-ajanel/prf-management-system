// Snapshot tests for components that have intentionally moved on from the pre-extraction baseline.
//
// The parity suites pin markup to commit 84fee05, which is exactly right for proving the extraction was
// lossless — but wrong for anything we deliberately change afterwards. A component that gains a feature
// SHOULD differ from the baseline. Once that happens the component graduates out of parity and into here,
// where the committed snapshot becomes the thing that must not change by accident.
//
//   node design-system/test/snapshot.mjs           compare against committed snapshots
//   UPDATE=1 node design-system/test/snapshot.mjs  rewrite them (review the diff before committing)

import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const here = path.dirname(new URL(import.meta.url).pathname);
const snapDir = path.join(here, "__snapshots__");
const tmp = path.join(here, ".snap-tmp");
const UPDATE = process.env.UPDATE === "1";

await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(tmp, { recursive: true });
await fs.mkdir(snapDir, { recursive: true });

const outfile = path.join(tmp, "ds.mjs");
await build({
  stdin: { contents: `export * from "./src/index.ts"; export * from "./src/fixtures.ts";`, resolveDir: path.join(here, ".."), loader: "ts" },
  outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
  logOverride: { "ignored-directive": "silent" }, logLevel: "error",
});
const ds = await import(pathToFileURL(outfile).href);

const noop = () => {};
const withLine = (form, index, patch) => ({
  ...form,
  lineItems: form.lineItems.map((line, i) => (i === index ? { ...line, ...patch } : line)),
});

const awaiting = ds.sampleRequests.find(r => r.status === "Awaiting Approval");

const formBase = {
  setForm: noop, notice: "", accounting: [], accountingStatus: "Loading every active FY27 site…",
  lastSaved: "", dirty: false, onClose: noop, onSave: noop, onProceed: noop,
};

// ---- cases ---------------------------------------------------------------------------------------
const cases = [
  ["RequestModal.audit-closed", () => createElement(ds.RequestModal, { request: awaiting, onClose: noop, auditOpen: false, setAuditOpen: noop, canApprove: false, onAction: noop })],
  ["RequestModal.audit-open", () => createElement(ds.RequestModal, { request: awaiting, onClose: noop, auditOpen: true, setAuditOpen: noop, canApprove: false, onAction: noop })],
  ["RequestModal.approvable", () => createElement(ds.RequestModal, { request: awaiting, onClose: noop, auditOpen: false, setAuditOpen: noop, canApprove: true, onAction: noop })],
  ["RequestModal.divvy", () => createElement(ds.RequestModal, { request: { ...awaiting, paymentType: "divvy" }, onClose: noop, auditOpen: false, setAuditOpen: noop, canApprove: true, onAction: noop })],
  ["RequestModal.custom-site", () => createElement(ds.RequestModal, { request: { ...awaiting, siteCode: "", customSite: true }, onClose: noop, auditOpen: false, setAuditOpen: noop, canApprove: false, onAction: noop })],
  ["Finance.unfiltered", () => createElement(ds.Finance, { requests: ds.sampleRequests, all: ds.sampleRequests, filters: ds.emptyFinanceFilters, setFilters: noop, onOpen: noop, districts: ds.sampleDistricts })],
  ["Finance.no-matches", () => createElement(ds.Finance, { requests: [], all: ds.sampleRequests, filters: { ...ds.emptyFinanceFilters, query: "zzz" }, setFilters: noop, onOpen: noop, districts: ds.sampleDistricts })],
  ["QueueItem.awaiting", () => createElement(ds.QueueItem, { request: awaiting, onOpen: noop })],
  ["QueueItem.divvy", () => createElement(ds.QueueItem, { request: { ...awaiting, paymentType: "divvy" }, onOpen: noop })],
  ["PrfNumber.plain", () => createElement(ds.PrfNumber, { id: "PRF-FY27-0001" })],
  ["PrfNumber.divvy", () => createElement(ds.PrfNumber, { id: "PRF-FY27-0009", paymentType: "divvy" })],
  ["PrfNumber.verbose", () => createElement(ds.PrfNumber, { id: "PRF-FY27-0009", paymentType: "direct", verbose: true })],
  ["ExportButton.rows", () => createElement(ds.ExportButton, { requests: ds.sampleRequests, filters: { status: "Approved", site: "Beachy" } })],
  ["ExportButton.empty", () => createElement(ds.ExportButton, { requests: [] })],
  ["NotificationBell.empty", () => createElement(ds.NotificationBell, { notifications: [] })],
  ["RequestForm.custom-site", () => createElement(ds.RequestForm, { ...formBase, form: { ...ds.filledPrfForm(), customSite: true, siteCode: "", siteName: "Vista Verde Academy", school: "Vista Verde Academy" } })],
  ["RequestForm.blank", () => createElement(ds.RequestForm, { ...formBase, form: ds.emptyPrfForm() })],
  ["RequestForm.filled", () => createElement(ds.RequestForm, { ...formBase, form: ds.filledPrfForm(), accounting: ds.sampleAccounting })],
  ["RequestForm.dirty", () => createElement(ds.RequestForm, { ...formBase, form: ds.filledPrfForm(), dirty: true })],
  ["RequestForm.saved", () => createElement(ds.RequestForm, { ...formBase, form: ds.filledPrfForm(), lastSaved: "Saved 9:06 AM" })],
  ["RequestForm.notice", () => createElement(ds.RequestForm, { ...formBase, form: ds.emptyPrfForm(), notice: "Vendor, amount, and description are required." })],
  ["RequestForm.negative-line", () => createElement(ds.RequestForm, { ...formBase, form: withLine(ds.filledPrfForm(), 0, { amount: "-250" }) })],
  ["RequestForm.asset-transport-blocked", () => createElement(ds.RequestForm, {
    ...formBase,
    form: withLine({ ...ds.filledPrfForm(), school: "Manual Arts High School", siteName: "Manual Arts High School", fundingCode: "ASSET — Restricted" }, 0, { expenseType: "Transportation" }),
  })],
  ["RequestForm.pasadena-info", () => createElement(ds.RequestForm, {
    ...formBase, form: { ...ds.filledPrfForm(), school: "Field ES - Pasadena", siteName: "Field ES - Pasadena" },
  })],
];

// ---- stylesheet ----------------------------------------------------------------------------------
// The concatenated stylesheet gets a recorded hash rather than a full snapshot: it is 30 KB of minified
// CSS that nobody will read in a diff, but an unexplained change to it still has to fail the build.
const stylesDir = path.join(here, "..", "src", "styles");
const entry = await fs.readFile(path.join(stylesDir, "styles.css"), "utf8");
const order = [...entry.matchAll(/@import "\.\/(.+?)"/g)].map(m => m[1]);
const layers = await Promise.all(order.map(f => fs.readFile(path.join(stylesDir, f), "utf8")));
const cssHash = createHash("sha256").update(layers.join("")).digest("hex").slice(0, 16);

// Structural invariants that must hold no matter how the styles evolve.
const onDisk = (await fs.readdir(stylesDir)).filter(f => f.endsWith(".css") && f !== "styles.css").sort();
const structural = [];
const orphans = onDisk.filter(f => !order.includes(f));
if (orphans.length) structural.push(`layer files never imported by styles.css: ${orphans.join(", ")}`);
const missing = order.filter(f => !onDisk.includes(f));
if (missing.length) structural.push(`styles.css imports files that do not exist: ${missing.join(", ")}`);
const dupes = order.filter((f, i) => order.indexOf(f) !== i);
if (dupes.length) structural.push(`imported more than once: ${dupes.join(", ")}`);

// ---- run -----------------------------------------------------------------------------------------
const failures = [];
let checked = 0;

for (const [name, element] of cases) {
  const file = path.join(snapDir, `${name}.html`);
  const actual = renderToStaticMarkup(element()) + "\n";
  checked++;
  if (UPDATE) { await fs.writeFile(file, actual); continue; }
  let expected;
  try { expected = await fs.readFile(file, "utf8"); }
  catch { failures.push(`${name}: no committed snapshot — run UPDATE=1 node design-system/test/snapshot.mjs`); continue; }
  if (actual !== expected) {
    let at = 0;
    while (at < Math.max(actual.length, expected.length) && actual[at] === expected[at]) at++;
    failures.push(
      `${name}: differs at offset ${at}\n` +
      `      snapshot: …${expected.slice(Math.max(0, at - 50), at + 90)}\n` +
      `      current : …${actual.slice(Math.max(0, at - 50), at + 90)}`,
    );
  }
}

const hashFile = path.join(snapDir, "styles.sha256");
checked++;
if (UPDATE) {
  await fs.writeFile(hashFile, `${cssHash}\n`);
} else {
  const recorded = await fs.readFile(hashFile, "utf8").catch(() => "").then(s => s.trim());
  if (!recorded) failures.push("stylesheet: no recorded hash — run UPDATE=1 node design-system/test/snapshot.mjs");
  else if (recorded !== cssHash) failures.push(`stylesheet changed: recorded ${recorded}, current ${cssHash} (${order.length} layers). If intentional, re-record it in the same commit.`);
}
failures.push(...structural);

await fs.rm(tmp, { recursive: true, force: true });

if (UPDATE) { console.log(`\n  ✎ rewrote ${cases.length} snapshots + stylesheet hash (${cssHash})\n`); process.exit(0); }
if (failures.length) {
  console.error(`\n  ✗ ${failures.length} snapshot check(s) FAILED\n`);
  failures.forEach(line => console.error(`    ${line}\n`));
  process.exit(1);
}
console.log(`\n  ✓ ${checked} snapshot checks match (${order.length} style layers, css ${cssHash})\n`);
