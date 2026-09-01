// Render parity: extracted components must produce byte-identical markup to the originals.
//
// A typecheck proves the props line up; it says nothing about the emitted HTML. Since every visual in this
// system is driven by class names in globals.css, a dropped or renamed class would be invisible to tsc and
// catastrophic in the design tool — each synced component would render unstyled in every design built from
// it. So this harness renders both implementations and diffs the markup.
//
// The originals are pulled from the pre-extraction commit and bundled with an export shim, since they are
// module-private functions in app/page.tsx. Effects do not run under renderToStaticMarkup, so what is
// compared is first-paint markup — which is exactly what the preview cards capture.
//
//   node design-system/test/render-parity.mjs

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const BASELINE = "84fee05";
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "..", "..");
const tmp = path.join(here, ".render-tmp");

const ORIGINAL_EXPORTS = [
  "PageHead", "MonthFilter", "Summary", "StatusPill", "RequestTrail",
  "SearchableCombobox", "SignatureField", "RequestModal", "Finance",
];

await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(tmp, { recursive: true });

// ---- bundle the originals out of the baseline commit ---------------------------------------------
const baselineSource = execFileSync("git", ["show", `${BASELINE}:app/page.tsx`], { cwd: root, encoding: "utf8" });
const shimmed = `${baselineSource}\nexport { ${ORIGINAL_EXPORTS.join(", ")} };\n`;
const shimPath = path.join(tmp, "original.tsx");
await fs.writeFile(shimPath, shimmed);
await build({
  entryPoints: [shimPath], outfile: path.join(tmp, "original.mjs"), bundle: true,
  format: "esm", platform: "node", jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"], logLevel: "silent",
});
const original = await import(pathToFileURL(path.join(tmp, "original.mjs")).href);

// ---- bundle the extracted design system ----------------------------------------------------------
await build({
  stdin: { contents: `export * from "./src/index.ts"; export * from "./src/fixtures.ts";`, resolveDir: path.join(here, ".."), loader: "ts" }, outfile: path.join(tmp, "extracted.mjs"),
  bundle: true, format: "esm", platform: "node", jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"], logLevel: "silent",
});
const extracted = await import(pathToFileURL(path.join(tmp, "extracted.mjs")).href);

// ---- fixtures ------------------------------------------------------------------------------------
const noop = () => {};
const comboOptions = [
  { value: "", label: "-- select --" },
  { value: "7704|Central High School", label: "Central High School (7704)", group: "--- SCHOOL SITES ---", search: "Central High School 7704 88STEM South", title: "STEM enrichment site" },
  { value: "7711|Roosevelt Elementary", label: "Roosevelt Elementary (7711)", group: "--- SCHOOL SITES ---", search: "Roosevelt Elementary 7711 ELOP27" },
  { value: "FIN|Finance", label: "Finance (FIN)", group: "--- DEPARTMENTS / OVERHEAD ---", search: "Finance FIN WRSHARED" },
];

// Fixtures come from the extracted package and are handed to BOTH implementations, so the comparison is
// over behaviour rather than over each side's own sample data.
const { sampleRequests, sampleDistricts, emptyFinanceFilters } = extracted;
const drafts = sampleRequests.filter(r => r.status === "Draft");
const approved = sampleRequests.find(r => r.status === "Approved");
const awaiting = sampleRequests.find(r => r.status === "Awaiting Approval");

// The ten props RequestForm originally took. Extracted adds optional ones with defaults, so passing only
// these exercises the defaults — which is exactly what has to stay identical.
const formBase = {
  setForm: noop, notice: "", accounting: [], accountingStatus: "Loading every active FY27 site…",
  lastSaved: "", dirty: false, onClose: noop, onSave: noop, onProceed: noop,
};

// Rule fixtures. With no accounting rows, the component resolves siteName from form.school, which is what
// both policy rules match on.
const withLine = (form, index, patch) => {
  const lineItems = form.lineItems.map((line, i) => (i === index ? { ...line, ...patch } : line));
  return { ...form, lineItems };
};
const negativeForm = withLine(extracted.filledPrfForm(), 0, { amount: "-250" });
const blockedForm = withLine(
  { ...extracted.filledPrfForm(), school: "Manual Arts High School", siteName: "Manual Arts High School", fundingCode: "ASSET — Restricted" },
  0,
  { expenseType: "Transportation" },
);
const pasadenaForm = { ...extracted.filledPrfForm(), school: "Field ES - Pasadena", siteName: "Field ES - Pasadena" };

const cases = [
  ["StatusPill/draft", "StatusPill", { status: "Draft" }],
  ["StatusPill/awaiting", "StatusPill", { status: "Awaiting Approval" }],
  ["StatusPill/returned", "StatusPill", { status: "Returned" }],
  ["StatusPill/approved", "StatusPill", { status: "Approved" }],
  ["PageHead/plain", "PageHead", { eyebrow: "Requester workspace", title: "My Requests", copy: "Resume drafts, track approvals, and retrieve completed requests." }],
  ["PageHead/action", "PageHead", { eyebrow: "Approval center", title: "Review Queue", copy: "Routed by dollar threshold.", action: "ACTION_SLOT" }],
  ["MonthFilter/empty", "MonthFilter", { value: "", onChange: noop }],
  ["MonthFilter/selected", "MonthFilter", { value: "2026-07", onChange: noop }],
  ["SignatureField/type-empty", "SignatureField", { value: "", mode: "type", onMode: noop, onChange: noop }],
  ["SignatureField/type-filled", "SignatureField", { value: "Giselle Ajanel", mode: "type", onMode: noop, onChange: noop }],
  ["SignatureField/draw", "SignatureField", { value: "", mode: "draw", onMode: noop, onChange: noop }],
  ["SearchableCombobox/empty", "SearchableCombobox", { label: "SITE", value: "", options: comboOptions, onChange: noop, placeholder: "Search all sites by name or code…" }],
  ["SearchableCombobox/selected", "SearchableCombobox", { label: "SITE", value: "7704|Central High School", options: comboOptions, onChange: noop }],
  ["SearchableCombobox/disabled", "SearchableCombobox", { label: "FUNDING SOURCE", value: "", options: comboOptions, onChange: noop, disabled: true, placeholder: "Select a site first" }],
  ["SearchableCombobox/bare-label", "SearchableCombobox", { label: "", value: "", options: comboOptions, onChange: noop }],

  // ---- tier 2 ------------------------------------------------------------------------------------
  ["Summary/populated", "Summary", { requests: sampleRequests }],
  ["Summary/empty", "Summary", { requests: [] }],
  ["Summary/drafts-only", "Summary", { requests: drafts }],
  ["RequestTrail/mixed", "RequestTrail", { requests: sampleRequests, onOpen: noop, onResume: noop, title: "Your request trail" }],
  ["RequestTrail/empty", "RequestTrail", { requests: [], onOpen: noop, onResume: noop, title: "All requests" }],
  ["RequestTrail/drafts-only", "RequestTrail", { requests: drafts, onOpen: noop, onResume: noop, title: "Open drafts" }],
  ["RequestModal/audit-closed", "RequestModal", { request: awaiting, onClose: noop, auditOpen: false, setAuditOpen: noop, canApprove: false, onAction: noop }],
  ["RequestModal/audit-open", "RequestModal", { request: awaiting, onClose: noop, auditOpen: true, setAuditOpen: noop, canApprove: false, onAction: noop }],
  ["RequestModal/approvable", "RequestModal", { request: awaiting, onClose: noop, auditOpen: false, setAuditOpen: noop, canApprove: true, onAction: noop }],
  ["RequestModal/approved", "RequestModal", { request: approved, onClose: noop, auditOpen: true, setAuditOpen: noop, canApprove: false, onAction: noop }],
  ["RequestModal/no-documents", "RequestModal", { request: drafts[0], onClose: noop, auditOpen: false, setAuditOpen: noop, canApprove: false, onAction: noop }],
  ["Finance/unfiltered", "Finance", { requests: sampleRequests, all: sampleRequests, filters: emptyFinanceFilters, setFilters: noop, onOpen: noop, districts: sampleDistricts }],
  ["Finance/district-selected", "Finance", { requests: sampleRequests.filter(r => r.district === "District 4"), all: sampleRequests, filters: { ...emptyFinanceFilters, district: "District 4" }, setFilters: noop, onOpen: noop, districts: sampleDistricts }],
  ["Finance/no-matches", "Finance", { requests: [], all: sampleRequests, filters: { ...emptyFinanceFilters, query: "nothing matches this" }, setFilters: noop, onOpen: noop, districts: sampleDistricts }],

];

// ---- compare -------------------------------------------------------------------------------------
const failures = [];
let compared = 0;

for (const [name, component, props] of cases) {
  const Original = original[component];
  const Extracted = extracted[component];
  if (!Original) { failures.push(`${name}: original ${component} not exported from baseline`); continue; }
  if (!Extracted) { failures.push(`${name}: extracted ${component} not exported from design system`); continue; }

  const render = Component => {
    try {
      return renderToStaticMarkup(createElement(Component, props));
    } catch (error) {
      return `THREW: ${error.message}`;
    }
  };

  const a = render(Original);
  const b = render(Extracted);
  compared++;
  if (a !== b) {
    failures.push(`${name}\n      original : ${a.slice(0, 220)}\n      extracted: ${b.slice(0, 220)}`);
  }
}


await fs.rm(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n  ✗ ${failures.length} of ${compared} render comparisons FAILED\n`);
  failures.forEach(line => console.error(`    ${line}\n`));
  process.exit(1);
}
console.log(`\n  ✓ ${compared} render comparisons matched the originals at ${BASELINE} exactly\n`);
