// Differential test: the extracted utils must behave exactly like the originals in app/page.tsx.
//
// The `original` block below is copied verbatim (bar type annotations) from the pre-extraction page.tsx at
// commit 84fee05. Every helper is run against a shared input matrix and compared. Any divergence fails.
//
//   node design-system/test/utils-parity.mjs

import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = path.join(here, ".parity-tmp");

// ---- original implementations, verbatim from app/page.tsx @ 84fee05 -------------------------------
const MAX_AMOUNT = 100_000_000;
const original = {
  amountOf: (value) => { const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim()); return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_AMOUNT) : 0 },
  isNegative: (value) => { const parsed = Number(String(value ?? "").trim()); return Number.isFinite(parsed) && parsed < 0 },
  countOf: (value) => { const parsed = Number(String(value ?? "").trim()); return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 1_000_000) : 0 },
  money: (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0),
  vague: (text) => text.trim().length < 28 || /^(supplies|materials|equipment|services|books|food)$/i.test(text.trim()),
  routeFor: (amount) => !Number.isFinite(amount) || amount <= 0 ? "Manager" : amount <= 5000 ? "Manager" : amount <= 15000 ? "Director" : amount <= 25000 ? "Senior Director" : amount <= 75000 ? "Chief" : amount <= 250000 ? "CFO + CEO" : "CEO",
  siteKeyOf: (siteCode, siteName) => { const code = String(siteCode ?? "").trim(), name = String(siteName ?? "").trim(); return code || name ? `${code}|${name}` : "" },
  currentMonth: () => new Date().toISOString().slice(0, 7),
  monthLabel: (value) => new Date(`${value}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
};

// ---- input matrix --------------------------------------------------------------------------------
// Deliberately includes the values the original comments call out: NaN, Infinity, negatives, blanks,
// non-strings, tier boundaries, and the exact words the vagueness check rejects.
const numeric = [
  0, 1, -1, 0.5, 5000, 5000.01, 15000, 15001, 25000, 25001, 75000, 75001, 250000, 250001,
  1e9, NaN, Infinity, -Infinity, "", " ", "  42  ", "42.75", "-3", "abc", "1e3", "0x10",
  null, undefined, true, false, [], [5], {}, "100000001", 100_000_001, 1_000_001,
];
const texts = [
  "", " ", "Supplies", "supplies", "MATERIALS", "equipment", "services", "books", "food",
  "Short", "Twenty seven characters ok!", "Twenty eight characters here.",
  "24 robotics kits for the Grade 9 after-school STEM lab", "   padded but long enough to pass the check   ",
];
const sitePairs = [
  ["7704", "Central High School"], ["", ""], [" ", " "], ["2324", "McKinley ES"],
  [null, undefined], [7704, "Numeric code"], ["", "Name only"], ["Code only", ""],
];
const months = ["2026-01", "2026-08", "2026-12", "2025-06", "2027-02"];

// ---- run -----------------------------------------------------------------------------------------
await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(tmp, { recursive: true });
const outfile = path.join(tmp, "utils.mjs");
await build({ entryPoints: [path.join(here, "..", "src", "utils.ts")], outfile, bundle: true, format: "esm", platform: "neutral", logLevel: "silent" });
const extracted = await import(pathToFileURL(outfile).href);

let checks = 0;
const failures = [];
const compare = (name, args, a, b) => {
  checks++;
  const same = Number.isNaN(a) && Number.isNaN(b) ? true : a === b;
  if (!same) failures.push(`${name}(${args.map(v => JSON.stringify(v)).join(", ")}) → original ${JSON.stringify(a)} vs extracted ${JSON.stringify(b)}`);
};

for (const value of numeric) {
  for (const fn of ["amountOf", "isNegative", "countOf", "routeFor"]) compare(fn, [value], original[fn](value), extracted[fn](value));
  compare("money", [value], original.money(value), extracted.money(value));
}
for (const text of texts) compare("vague", [text], original.vague(text), extracted.vague(text));
for (const [code, name] of sitePairs) compare("siteKeyOf", [code, name], original.siteKeyOf(code, name), extracted.siteKeyOf(code, name));
for (const month of months) compare("monthLabel", [month], original.monthLabel(month), extracted.monthLabel(month));
compare("currentMonth", [], original.currentMonth(), extracted.currentMonth());
compare("MAX_AMOUNT", [], MAX_AMOUNT, extracted.MAX_AMOUNT);

await fs.rm(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n  ✗ ${failures.length} of ${checks} parity checks FAILED\n`);
  failures.forEach(line => console.error(`    ${line}`));
  process.exit(1);
}
console.log(`\n  ✓ ${checks} parity checks passed — extracted utils match app/page.tsx @ 84fee05\n`);
