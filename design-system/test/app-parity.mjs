// App parity: the refactored page must render exactly like the pre-extraction page.
//
// This is the check that makes the single-source-of-truth switch safe. app/page.tsx no longer defines its
// own components — it imports them — so the question is not whether each component matches in isolation
// (render-parity and slice-parity cover that) but whether the assembled page is unchanged.
//
// Three view states are compared, since each renders a different branch of the page.
//
//   node design-system/test/app-parity.mjs

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
const tmp = path.join(here, ".app-tmp");

await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(tmp, { recursive: true });

const external = ["react", "react-dom", "react/jsx-runtime", "react-dom/client"];
const alias = { "@ds": path.join(root, "design-system", "src", "index.ts") };

const compile = async (name, code) => {
  const entry = path.join(tmp, `${name}.tsx`);
  await fs.writeFile(entry, code);
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({
    entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external, alias, absWorkingDir: root, logOverride: { "ignored-directive": "silent" },
    logLevel: "error",
  });
  return import(pathToFileURL(outfile).href);
};

// Each variant flips only initial useState values so a different view branch renders. No logic is changed.
const variants = [
  ["overview", src => src],
  ["approvals", src => src.replace('useState<View>("overview")', 'useState<View>("approvals")')],
  ["requests", src => src.replace('useState<View>("overview")', 'useState<View>("requests")')],
];

const before = execFileSync("git", ["show", `${BASELINE}:app/page.tsx`], { cwd: root, encoding: "utf8" });
const after = await fs.readFile(path.join(root, "app", "page.tsx"), "utf8");

const failures = [];
for (const [view, patch] of variants) {
  const beforeSrc = patch(before), afterSrc = patch(after);
  if (beforeSrc === before && view !== "overview") { failures.push(`${view}: could not patch the baseline's initial view`); continue; }
  if (afterSrc === after && view !== "overview") { failures.push(`${view}: could not patch the current page's initial view`); continue; }

  const oldPage = await compile(`before-${view}`, beforeSrc);
  const newPage = await compile(`after-${view}`, afterSrc);
  const a = renderToStaticMarkup(createElement(oldPage.default));
  const b = renderToStaticMarkup(createElement(newPage.default));

  if (a !== b) {
    let at = 0;
    while (at < Math.max(a.length, b.length) && a[at] === b[at]) at++;
    failures.push(
      `${view}: markup differs at offset ${at} (${a.length} vs ${b.length} bytes)\n` +
      `      before: …${a.slice(Math.max(0, at - 60), at + 100)}\n` +
      `      after : …${b.slice(Math.max(0, at - 60), at + 100)}`,
    );
  }
}

await fs.rm(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n  ✗ ${failures.length} of ${variants.length} views FAILED\n`);
  failures.forEach(line => console.error(`    ${line}\n`));
  process.exit(1);
}
console.log(`\n  ✓ all ${variants.length} views render identically to the page at ${BASELINE}\n`);
