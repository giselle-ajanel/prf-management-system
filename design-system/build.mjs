// Builds design-system/dist: the compiled artifacts the design-sync converter consumes.
//
//   node design-system/build.mjs
//
// Three outputs:
//   dist/index.js    ESM bundle, React left external so the host supplies one copy
//   dist/index.d.ts  the public API contract, emitted by tsc
//   dist/styles.css  the 24 style layers concatenated in @import order
//
// The stylesheet is concatenated rather than run through a CSS bundler on purpose. The cascade in this
// system is load-bearing — .modalBackdrop and .ruleBanner are each redefined by later layers — so the
// output must reproduce the original file byte for byte, and a plain ordered concat is the only approach
// that provably does. design-system/test/css-parity.mjs asserts exactly that.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "..");
const dist = path.join(here, "dist");
const bytes = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const step = (...args) => console.log(" ", ...args);

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

// ---- javascript ----------------------------------------------------------------------------------
step("bundling components…");
const result = await build({
  entryPoints: [path.join(here, "src", "index.ts")],
  outfile: path.join(dist, "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome109", "edge109", "firefox115", "safari16"],
  jsx: "automatic",
  // React stays external: the design tool's runtime provides it, and two copies would break hooks.
  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client", "react-dom/server"],
  legalComments: "none",
  metafile: true,
  // Every interactive component carries "use client" for Next.js. esbuild has nothing to do with it.
  logOverride: { "ignored-directive": "silent" },
  logLevel: "warning",
});
const jsBytes = (await fs.stat(path.join(dist, "index.js"))).size;

// ---- stylesheet ----------------------------------------------------------------------------------
step("concatenating style layers…");
const stylesDir = path.join(here, "src", "styles");
const entry = await fs.readFile(path.join(stylesDir, "styles.css"), "utf8");
const order = [...entry.matchAll(/@import "\.\/(.+?)"/g)].map(m => m[1]);
if (!order.length) throw new Error("styles.css declares no @import layers");
const layers = await Promise.all(order.map(file => fs.readFile(path.join(stylesDir, file), "utf8")));
const css = layers.join("");
await fs.writeFile(path.join(dist, "styles.css"), css);

// ---- declarations --------------------------------------------------------------------------------
step("emitting declarations…");
execFileSync("npx", ["tsc", "-p", path.join(here, "tsconfig.build.json")], { cwd: root, stdio: "inherit" });

// ---- report --------------------------------------------------------------------------------------
const componentDir = path.join(here, "src", "components");
const components = (await fs.readdir(componentDir)).filter(f => f.endsWith(".tsx")).length;
await fs.writeFile(
  path.join(dist, ".build-meta.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), components, styleLayers: order.length, jsBytes, cssBytes: css.length }, null, 2),
);

step(`js ${bytes(jsBytes)} · css ${bytes(css.length)} across ${order.length} layers · ${components} component files`);
console.log(`\n  ✓ design-system/dist ready\n`);
