// Slice parity: components assembled from inline JSX must reproduce the app's own markup exactly.
//
// AppHeader, Hero, ActionRow, AppFooter, QueueItem and SessionDialog had no function to extract — their
// markup was written inline inside PurchaseRequestHub. So instead of comparing function to function, this
// renders the original page and compares each new component against the corresponding slice of that output.
//
// QueueItem and SessionDialog only appear in states the first render never reaches (the approvals view, and
// an expired session). To reach them, the baseline source is rebuilt with those two initial useState values
// flipped — initial state only, no logic touched — which is enough to render the markup they produce.
//
//   node design-system/test/slice-parity.mjs

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
const tmp = path.join(here, ".slice-tmp");

await fs.rm(tmp, { recursive: true, force: true });
await fs.mkdir(tmp, { recursive: true });

const source = execFileSync("git", ["show", `${BASELINE}:app/page.tsx`], { cwd: root, encoding: "utf8" });

const compile = async (name, code) => {
  const entry = path.join(tmp, `${name}.tsx`);
  await fs.writeFile(entry, code);
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({
    entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"], logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
};

// Variant: start on the approvals view with an expired session, so the queue row and the session prompt
// are both present in the first render.
const variantSource = source
  .replace('useState<View>("overview")', 'useState<View>("approvals")')
  .replace("const [sessionExpired,setSessionExpired]=useState(false)", "const [sessionExpired,setSessionExpired]=useState(true)");
if (variantSource === source) {
  console.error("\n  ✗ could not patch initial state — the baseline source has changed shape\n");
  process.exit(1);
}

const baseline = await compile("baseline", source);
const variant = await compile("variant", variantSource);
const ds = await compile("ds", `export * from ${JSON.stringify(path.join(here, "..", "src", "index.ts"))}; export * from ${JSON.stringify(path.join(here, "..", "src", "fixtures.ts"))};`);

const baseHtml = renderToStaticMarkup(createElement(baseline.default));
const variantHtml = renderToStaticMarkup(createElement(variant.default));

const slice = (html, open, close) => {
  const start = html.indexOf(open);
  if (start < 0) return null;
  const end = html.indexOf(close, start);
  return end < 0 ? null : html.slice(start, end + close.length);
};

const noop = () => {};
const money = ds.money;

const checks = [
  {
    name: "AppHeader",
    expected: slice(baseHtml, '<header class="topbar"', "</header>"),
    element: () => createElement(ds.AppHeader, {
      items: [
        { id: "overview", label: "Overview" },
        { id: "requests", label: "My Requests" },
        { id: "approvals", label: "Approvals" },
        { id: "finance", label: "Finance", disabled: true, title: "Finance permission required" },
      ],
      active: "overview", onNavigate: noop, onBrandClick: noop,
      initials: "GA", userName: "Giselle Ajanel", userRole: "Requester", userOrg: "Woodcraft — Finance",
      roles: ["Requester", "Finance"], onRoleChange: noop,
    }),
  },
  {
    name: "Hero",
    expected: slice(baseHtml, '<section class="hero"', "</section>"),
    element: () => createElement(ds.Hero, {
      eyebrow: "FY 2027 · SPENDING CYCLE 01",
      title: "Purchasing made",
      titleAccent: "clear & connected.",
      copy: "Create, route, and track every purchase request in one friendly workspace—without chasing forms or email threads.",
      primaryLabel: "Start a new request", onPrimary: noop,
      secondaryLabel: "View my requests", onSecondary: noop,
      trailCard: { id: "PRF-FY27-0001", status: "Awaiting approval", note: "Requester signed · Director next" },
    }),
  },
  {
    name: "ActionRow + ReviewPanel + TipPanel",
    expected: slice(baseHtml, '<section class="actionRow"', "</article></section>"),
    element: () => createElement(ds.ActionRow, null,
      createElement(ds.ReviewPanel, {
        key: "review",
        eyebrow: "YOUR QUEUE",
        title: "One request is ready for your review.",
        copy: "Student enrichment materials for Site 7704 have all required documents and a requester signature.",
        amount: "$8,425", actionLabel: "Review request →", onAction: noop,
      }),
      createElement(ds.TipPanel, {
        key: "tip",
        title: "Help requests move faster",
        copy: "Brief descriptions are flagged before submission. Include specific items, quantities, intended users, and educational purpose.",
        actionLabel: "Create a clear request →", onAction: noop,
      }),
    ),
  },
  {
    name: "AppFooter",
    expected: slice(baseHtml, "<footer>", "</footer>"),
    element: () => createElement(ds.AppFooter, null),
  },
  {
    name: "QueueItem",
    expected: slice(variantHtml, '<article class="queueItem"', "</article>"),
    element: () => {
      const request = ds.sampleRequests.find(r => r.status === "Awaiting Approval");
      return createElement(ds.QueueItem, { request, onOpen: noop });
    },
  },
  {
    name: "SessionDialog",
    expected: slice(variantHtml, '<div class="modalBackdrop sessionBackdrop"', "</section></div>"),
    element: () => createElement(ds.SessionDialog, { onRefresh: noop }),
  },
];

const failures = [];
for (const { name, expected, element } of checks) {
  if (!expected) { failures.push(`${name}: could not locate the matching slice in the app's rendered output`); continue; }
  const actual = renderToStaticMarkup(element());
  if (actual !== expected) {
    let at = 0;
    while (at < Math.max(actual.length, expected.length) && actual[at] === expected[at]) at++;
    failures.push(
      `${name}: markup differs at offset ${at}\n` +
      `      app      : …${expected.slice(Math.max(0, at - 50), at + 90)}\n` +
      `      component: …${actual.slice(Math.max(0, at - 50), at + 90)}`,
    );
  }
}

await fs.rm(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n  ✗ ${failures.length} of ${checks.length} slices FAILED\n`);
  failures.forEach(line => console.error(`    ${line}\n`));
  process.exit(1);
}
console.log(`\n  ✓ ${checks.length} components reproduce their slice of the app's markup exactly\n`);
