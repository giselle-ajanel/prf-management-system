// Whole-page snapshots for each state of the Hub.
//
// This replaced app-parity.mjs, which compared the page against the pre-extraction commit. That comparison
// did its job — it proved that pointing app/page.tsx at the design system changed nothing — and is now
// permanently false. What is still worth guarding is that a change to one component does not quietly alter
// a page nobody was looking at, so the assembled page is snapshotted instead.
//
// Since the Hub gained authentication, the page renders from server state rather than a seed array, and
// what it renders first is the sign-in gate. Each variant below patches initial useState values so a
// different branch renders — no logic is touched, and no effect runs, because renderToStaticMarkup does
// not run effects. The role variants are the point: the requester page and the approver page are different
// applications sharing a shell, and this is where that stays true.
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

const SESSION_STATE = 'useState<SessionInfo|null>(null)';
const REQUESTS_STATE = 'useState<Request[]>([])';
const VIEW_STATE = 'useState<View>("overview")';

const signedIn = (role, name, district, school) =>
  `useState<SessionInfo|null>({authenticated:true,csrfToken:"test",user:{name:"${name}",email:"${name.toLowerCase().replace(" ", ".")}@woodcraftrangers.org",role:"${role}",district:"${district}",school:"${school}"}})`;

/** Replaces exactly one occurrence, and fails loudly when the page has changed shape underneath us. */
const swap = (source, find, replace, label) => {
  if (!source.includes(find)) throw new Error(`${label}: could not find ${find}`);
  return source.replace(find, replace);
};

const withRequests = source =>
  swap(source, REQUESTS_STATE, "useState<Request[]>(sampleRequests)", "requests").replace(
    'from "@ds";',
    'from "@ds";\nimport { sampleRequests } from "@ds/fixtures";',
  );

const variants = [
  // The gate itself: no session, and a session the server has ended.
  ["checking", source => source],
  ["signed-out", source => swap(source, SESSION_STATE, 'useState<SessionInfo|null>({authenticated:false,passwordLoginEnabled:true})', "signed-out")],
  [
    "requester-overview",
    source => withRequests(swap(source, SESSION_STATE, signedIn("REQUESTER", "Giselle Ajanel", "District 4", "Central High School"), "requester")),
  ],
  [
    "requester-requests",
    source =>
      swap(
        withRequests(swap(source, SESSION_STATE, signedIn("REQUESTER", "Giselle Ajanel", "District 4", "Central High School"), "requester")),
        VIEW_STATE,
        'useState<View>("requests")',
        "view",
      ),
  ],
  [
    "approver-approvals",
    source =>
      swap(
        withRequests(swap(source, SESSION_STATE, signedIn("APPROVER", "Marcus Lee", "Woodcraft", "Finance"), "approver")),
        VIEW_STATE,
        'useState<View>("approvals")',
        "view",
      ),
  ],
  [
    "approver-finance",
    source =>
      swap(
        withRequests(swap(source, SESSION_STATE, signedIn("APPROVER", "Marcus Lee", "Woodcraft", "Finance"), "approver")),
        VIEW_STATE,
        'useState<View>("finance")',
        "view",
      ),
  ],
];

const failures = [];
let checked = 0;

for (const [name, patch] of variants) {
  let patched;
  try {
    patched = patch(source);
  } catch (error) {
    failures.push(`${name}: ${error.message} — app/page.tsx has changed shape`);
    continue;
  }
  const entry = path.join(tmp, `${name}.tsx`);
  await fs.writeFile(entry, patched);
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({
    entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
    alias: {
      "@ds": path.join(root, "design-system", "src", "index.ts"),
      "@ds/fixtures": path.join(root, "design-system", "src", "fixtures.ts"),
      "@/lib/prf-client": path.join(root, "lib", "prf-client.ts"),
    },
    absWorkingDir: root, logOverride: { "ignored-directive": "silent" }, logLevel: "error",
  });
  const mod = await import(pathToFileURL(outfile).href);
  const actual = renderToStaticMarkup(createElement(mod.default)) + "\n";
  const file = path.join(snapDir, `page.${name}.html`);
  checked++;

  if (UPDATE) { await fs.writeFile(file, actual); continue; }
  let expected;
  try { expected = await fs.readFile(file, "utf8"); }
  catch { failures.push(`${name}: no committed snapshot — run UPDATE=1 node design-system/test/page-snapshot.mjs`); continue; }
  if (actual !== expected) {
    let at = 0;
    while (at < Math.max(actual.length, expected.length) && actual[at] === expected[at]) at++;
    failures.push(
      `${name}: differs at offset ${at} (${expected.length} -> ${actual.length} bytes)\n` +
      `      snapshot: …${expected.slice(Math.max(0, at - 60), at + 100)}\n` +
      `      current : …${actual.slice(Math.max(0, at - 60), at + 100)}`,
    );
  }
}

// A requester's page must never contain the approver's surfaces, whatever the snapshots happen to hold.
// This is a property rather than a recording: it keeps holding when the markup is redesigned.
const requesterPage = await fs.readFile(path.join(snapDir, "page.requester-overview.html"), "utf8").catch(() => "");
if (requesterPage) {
  for (const forbidden of ["Approvals", "Review Queue", "Finance register", "Export"]) {
    if (requesterPage.includes(forbidden)) failures.push(`requester-overview: the requester page shows "${forbidden}"`);
  }
}

await fs.rm(tmp, { recursive: true, force: true });

if (UPDATE) { console.log(`\n  ✎ rewrote ${checked} page snapshots\n`); process.exit(0); }
if (failures.length) {
  console.error(`\n  ✗ ${failures.length} of ${variants.length} page snapshots FAILED\n`);
  failures.forEach(line => console.error(`    ${line}\n`));
  process.exit(1);
}
console.log(`\n  ✓ ${checked} page states match their snapshots\n`);
