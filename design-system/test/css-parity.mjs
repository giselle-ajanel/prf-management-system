// Regression test: the split stylesheet must remain byte-identical to the original app/globals.css.
//
// The cascade in the original file is load-bearing — .modalBackdrop (line 11) is redefined at line 30 with
// a higher z-index, and .ruleBanner (line 28) is patched at lines 36-38. Reordering the @import chain would
// silently change which rule wins, with no error anywhere. This test pins that down: concatenating the
// layers in @import order must reproduce the original exactly.
//
// The baseline is read from Git rather than the working tree so the test keeps working after app/globals.css
// is reduced to a single import of the design system.
//
//   node design-system/test/css-parity.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASELINE_REF = "84fee05:app/globals.css";
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "..", "..");
const dir = path.join(here, "..", "src", "styles");

const original = execFileSync("git", ["show", BASELINE_REF], { cwd: root, encoding: "utf8" });

const entry = fs.readFileSync(path.join(dir, "styles.css"), "utf8");
const order = [...entry.matchAll(/@import "\.\/(.+?)"/g)].map(m => m[1]);
if (!order.length) {
  console.error("\n  ✗ styles.css declares no @import layers\n");
  process.exit(1);
}

const rebuilt = order.map(file => fs.readFileSync(path.join(dir, file), "utf8")).join("");
const norm = value => value.replace(/\n+$/, "\n");

if (norm(rebuilt) !== norm(original)) {
  console.error(`\n  ✗ split stylesheet has DRIFTED from ${BASELINE_REF}`);
  console.error(`    rebuilt ${rebuilt.length} bytes from ${order.length} layers vs original ${original.length} bytes`);
  for (let i = 0; i < Math.max(rebuilt.length, original.length); i++) {
    if (rebuilt[i] !== original[i]) {
      console.error(`    first difference at byte ${i}`);
      console.error(`    rebuilt : ${JSON.stringify(rebuilt.slice(Math.max(0, i - 60), i + 60))}`);
      console.error(`    original: ${JSON.stringify(original.slice(Math.max(0, i - 60), i + 60))}`);
      break;
    }
  }
  process.exit(1);
}

console.log(`\n  ✓ ${order.length} style layers reproduce ${BASELINE_REF} exactly (${original.length} bytes)\n`);
