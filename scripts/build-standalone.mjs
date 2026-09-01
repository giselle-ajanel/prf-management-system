// Builds share/PRF-Hub.html: one self-contained file that runs the real app with no install and no server.
//
//   node scripts/build-standalone.mjs
//
// The FY27 site list is read straight through lib/accounting.ts, so the shared file can never drift from
// what /api/accounting-codes serves. The UI is the real app/page.tsx bundled with React — not a rewrite.
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root=path.resolve(import.meta.dirname,"..");
const at=(...parts)=>path.join(root,...parts);
const tmp=at(".standalone-tmp");

const bytes=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(2)} MB`;
const step=(...args)=>console.log(" ",...args);

async function accountingRows(){
  // Bundle the server module so the shared file uses the exact same parsing, status filtering and
  // de-duplication as the live API. "server-only" is a Next.js marker with no runtime body, so it is
  // aliased away; the workbook reader stays external and runs natively here.
  const compiled=path.join(tmp,"accounting.mjs");
  await build({entryPoints:[at("lib","accounting.ts")],outfile:compiled,bundle:true,platform:"node",format:"esm",target:"node18",alias:{"server-only":at("scripts","noop.js")},external:["read-excel-file","read-excel-file/node"],logLevel:"silent"});
  const {codesForAllSites}=await import(pathToFileURL(compiled).href);
  return codesForAllSites();
}

async function appBundle(options){
  const outfile=path.join(tmp,"app.js");
  await build({entryPoints:[at("scripts","standalone-entry.tsx")],outfile,bundle:true,platform:"browser",format:"iife",target:["chrome109","edge109","firefox115","safari16"],jsx:"automatic",minify:true,legalComments:"none",define:{"process.env.NODE_ENV":'"production"',__ACCOUNTING_PAYLOAD__:JSON.stringify({site:"All FY27 sites",scope:"all",options})},logLevel:"silent"});
  return fs.readFile(outfile,"utf8");
}

const shell=(css,js,count)=>`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PRF Command Center — Woodcraft Rangers</title>
<meta name="description" content="Purchase request creation, approval, and finance reporting. Self-contained build with ${count} active FY27 sites.">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<noscript><p style="font:16px system-ui;padding:40px">This page needs JavaScript enabled.</p></noscript>
<script>${js}</script>
</body>
</html>
`;

await fs.rm(tmp,{recursive:true,force:true});
await fs.mkdir(tmp,{recursive:true});
await fs.writeFile(at("scripts","noop.js"),"export default {};\n");
try{
  step("reading workbook via lib/accounting.ts…");
  const options=await accountingRows();
  const sites=new Set(options.map(row=>row.siteKey));
  const departments=new Set(options.filter(row=>row.source==="FY27").map(row=>row.siteKey)).size;
  step(`${sites.size} sites (${departments} departments / overhead, ${sites.size-departments} school sites) across ${options.length} funding rows`);

  step("bundling app/page.tsx with React…");
  const js=await appBundle(options);
  const css=await fs.readFile(at("app","globals.css"),"utf8");

  const html=shell(css,js,sites.size);
  await fs.mkdir(at("share"),{recursive:true});
  const outfile=at("share","PRF-Hub.html");
  await fs.writeFile(outfile,html);
  step(`css ${bytes(Buffer.byteLength(css))} · js ${bytes(Buffer.byteLength(js))}`);
  console.log(`\n  ✓ ${path.relative(root,outfile)} — ${bytes(Buffer.byteLength(html))}, single file, no install required\n`);
}finally{
  await fs.rm(tmp,{recursive:true,force:true});
  await fs.rm(at("scripts","noop.js"),{force:true});
}
