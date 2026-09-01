// Whole-page snapshots for each view of the Hub.
//
// This replaces app-parity.mjs, which compared the page against the pre-extraction commit. That
// comparison did its job — it proved that pointing app/page.tsx at the design system changed nothing —
// and is now permanently false, because the page has since gained the notification bell, export buttons
// and PRF number treatment. What is still worth guarding is that a change to one component does not
// quietly alter a page nobody was looking at, so the assembled page is snapshotted instead.
//
//   node design-system/test/page-snapshot.mjs
//   UPDATE=1 node design-system/test/page-snapshot.mjs

import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "..", "..");
const snapDir = path.join(here, "__snapshots__");
const tmp = path.join(here, ".page-tmp");
const UPDATE = process.env.UPDATE === "1";

await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(tmp, { recursive: true });
await fs.mkdir(snapDir, { recursive: true });

const source = await fs.readFile(path.join(root, "app", "page.tsx"), "utf8");

// Each variant flips only initial useState values so a different branch renders. No logic is touched.
const variants = [
  ["overview", src => src],
  ["requests", src => src.replace('useState<View>("overview")', 'useState<View>("requests")')],
  ["approvals", src => src.replace('useState<View>("overview")', 'useState<View>("approvals")')],
  [
    "finance",
    src =>
      src
        .replace('useState<View>("overview")', 'useState<View>("finance")')
        .replace('useState<"Requester"|"Finance">("Requester")', 'useState<"Requester"|"Finance">("Finance")'),
  ],
];

const failures = [];
let checked = 0;

for (const [view, patch] of variants) {
  const patched = patch(source);
  if (patched === source && view !== "overview") {
    failures.push(`${view}: could not patch initial state — page.tsx has changed shape`);
    continue;
  }
  const entry = path.join(tmp, `${view}.tsx`);
  await fs.writeFile(entry, patched);
  const outfile = path.join(tmp, `${view}.mjs`);
  await build({
    entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
    alias: { "@ds": path.join(root, "design-system", "src", "index.ts") },
    absWorkingDir: root, logOverride: { "ignored-directive": "silent" }, logLevel: "error",
  });
  const mod = await import(pathToFileURL(outfile).href);
  const actual = renderToStaticMarkup(createElement(mod.default)) + "\n";
  const file = path.join(snapDir, `page.${view}.html`);
  checked++;

  if (UPDATE) { await fs.writeFile(file, actual); continue; }
  let expected;
  try { expected = await fs.readFile(file, "utf8"); }
  catch { failures.push(`${view}: no committed snapshot — run UPDATE=1 node design-system/test/page-snapshot.mjs`); continue; }
  if (actual !== expected) {
    let at = 0;
    while (at < Math.max(actual.length, expected.length) && actual[at] === expected[at]) at++;
    failures.push(
      `${view}: differs at offset ${at} (${expected.length} -> ${actual.length} bytes)\n` +
      `      snapshot: …${expected.slice(Math.max(0, at - 60), at + 100)}\n` +
      `      current : …${actual.slice(Math.max(0, at - 60), at + 100)}`,
    );
  }
}

await fs.rm(tmp, { recursive: true, force: true });

if (UPDATE) { console.log(`\n  ✎ rewrote ${checked} page snapshots\n`); process.exit(0); }
if (failures.length) {
  console.error(`\n  ✗ ${failures.length} of ${variants.length} page snapshots FAILED\n`);
  failures.forEach(line => console.error(`    ${line}\n`));
  process.exit(1);
}
console.log(`\n  ✓ ${checked} page views match their snapshots\n`);
