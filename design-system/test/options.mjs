// Unit checks for the PRF editor's option builders.
//
// These cannot be covered by snapshots: the combobox menu is only rendered while the field is open, so a
// server-rendered snapshot of RequestForm contains no options at all. The bug this guards against is
// exactly that kind of invisible one — the site list was previously assembled from two named workbook tabs,
// so widening the reader to include Grants and Dept Codes added rows that never reached the dropdown.
//
//   node design-system/test/options.mjs

import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = path.join(here, ".options-tmp");
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
const check = (name, condition, detail = "") => {
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- every source reaches the dropdown -----------------------------------------------------------
const options = ds.buildSiteOptions(ds.sampleAccounting);
const groups = [...new Set(options.map(o => o.group).filter(Boolean))];
const sources = [...new Set(ds.sampleAccounting.map(r => r.source))];

check("sentinel row is first", options[0]?.value === "" && options[0]?.label === "-- select --");
check(
  "no site is dropped",
  options.filter(o => o.value).length === new Set(ds.sampleAccounting.map(r => r.siteKey)).size,
  `${options.filter(o => o.value).length} options for ${new Set(ds.sampleAccounting.map(r => r.siteKey)).size} unique sites`,
);
check("grants group present", groups.includes(ds.GRANT_GROUP), JSON.stringify(groups));
check("department group present", groups.includes(ds.DEPARTMENT_GROUP), JSON.stringify(groups));

// A site's group comes from the first source that introduced it. An override adding a funding source to a
// site the workbook already knows must merge into that site, not split it into a second entry — while an
// override introducing a brand new site gets its own group. Both cases are exercised by the fixtures.
const central = options.find(o => o.label.startsWith("Central High School"));
check("override merges into the existing site", options.filter(o => o.label.startsWith("Central High School")).length === 1);
check("merged site keeps its workbook group", central?.group === ds.SCHOOL_GROUP, `got ${central?.group}`);
check("override funding source joins the search text", central?.search.includes("Camino Nuevo Summer 26"), central?.search);
const newPartnership = options.find(o => o.label.startsWith("Vista Verde"));
check("override-only site appears", Boolean(newPartnership), "new partnership row was dropped");
check("override-only site is grouped as a Finance addition", newPartnership?.group === ds.OVERRIDE_GROUP, `got ${newPartnership?.group}`);
check("sources present in fixtures", sources.length >= 5, JSON.stringify(sources));

// ---- group ordering ------------------------------------------------------------------------------
const order = groups.map(g => ds.SITE_GROUP_ORDER.indexOf(g));
check("groups appear in the declared order", order.every((v, i) => i === 0 || order[i - 1] <= v), JSON.stringify(groups));

// ---- unmapped sources fall back rather than vanishing ---------------------------------------------
const withUnknown = ds.buildSiteOptions([
  ...ds.sampleAccounting,
  { source: "Some New Tab", fundingSource: "X", fundingSourceId: "", siteCode: "1", siteName: "Mystery Site", siteKey: "1|Mystery Site", region: "", expenseType: "", status: "Active", notes: "", availability: "active" },
]);
const mystery = withUnknown.find(o => o.label.startsWith("Mystery Site"));
check("unmapped source still appears", Boolean(mystery), "row from an unknown tab was dropped");
check("unmapped source lands in the fallback group", mystery?.group === ds.OTHER_GROUP, `got ${mystery?.group}`);

// ---- label handles rows with no numeric site code -------------------------------------------------
// Grants rows carry a label in place of a code; "Name ()" would look broken.
const grant = options.find(o => o.group === ds.GRANT_GROUP);
check("code-less rows omit the empty parenthetical", grant && !grant.label.includes("()"), `got ${grant?.label}`);

// ---- search terms ---------------------------------------------------------------------------------
check("search covers code", central?.search.includes("7704"));
check("search covers funding source", central?.search.includes("88STEM"));
check("search covers region", central?.search.includes("South"));

await fs.rm(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n  ✗ ${failures.length} option check(s) FAILED\n`);
  failures.forEach(line => console.error(`    ${line}`));
  process.exit(1);
}
console.log(`\n  ✓ site options: ${options.filter(o => o.value).length} sites across ${groups.length} groups, all sources represented\n`);

// ---- funding period expansion --------------------------------------------------------------------
const fundingFailures = [];
const fcheck = (name, condition, detail = "") => {
  if (!condition) fundingFailures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

fcheck("plain source expands to three periods",
  JSON.stringify(ds.expandFundingPeriods("Camino Nuevo")) ===
  JSON.stringify(["Camino Nuevo Summer 26", "Camino Nuevo 26-27", "Camino Nuevo 27-28"]),
  JSON.stringify(ds.expandFundingPeriods("Camino Nuevo")));

for (const exempt of ["WRSHARED", "wrshared", "Woodcraft Rangers", "Woodcraft"]) {
  fcheck(`${exempt} is never period-split`,
    JSON.stringify(ds.expandFundingPeriods(exempt)) === JSON.stringify([exempt]),
    JSON.stringify(ds.expandFundingPeriods(exempt)));
}

// A name that already states its period must not be expanded again into "TUPE 25-26 Summer 26".
for (const dated of ["TUPE 25-26", "Central 26-27", "Los Nietos Summer", "Play Equity Fund Girls Sports 22-25"]) {
  fcheck(`${dated} is left alone`,
    JSON.stringify(ds.expandFundingPeriods(dated)) === JSON.stringify([dated]),
    JSON.stringify(ds.expandFundingPeriods(dated)));
}

// Site-scoped funding: every non-exempt source for the site appears in all three periods.
const centralRows = ds.sampleAccounting.filter(r => r.siteKey === "7704|Central High School");
const fundingOpts = ds.buildFundingOptions(centralRows);
const labels = fundingOpts.filter(o => o.value).map(o => o.label);
fcheck("site funding is period-expanded", labels.some(l => l.endsWith("Summer 26")) && labels.some(l => l.endsWith("26-27")) && labels.some(l => l.endsWith("27-28")), JSON.stringify(labels));
fcheck("generated variants are tagged", fundingOpts.filter(o => o.tag).length >= 3, JSON.stringify(fundingOpts.map(o => o.tag)));
fcheck("no bare unexpanded base remains for an expandable source",
  !labels.includes("88STEM — STEM Enrichment"), JSON.stringify(labels));

// A value the request already holds stays selectable even when it is not in the site's list.
const withCurrent = ds.buildFundingOptions(centralRows, "Legacy Fund 24-25");
fcheck("existing value stays selectable", withCurrent.some(o => o.value === "Legacy Fund 24-25"));
fcheck("existing value is marked as entered", withCurrent.find(o => o.value === "Legacy Fund 24-25")?.tag === "as entered");

if (fundingFailures.length) {
  console.error(`\n  ✗ ${fundingFailures.length} funding check(s) FAILED\n`);
  fundingFailures.forEach(l => console.error(`    ${l}`));
  process.exit(1);
}
console.log(`  ✓ funding periods: ${labels.length} choices for one site, exemptions and existing periods respected\n`);
