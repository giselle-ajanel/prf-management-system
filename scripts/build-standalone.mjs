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

// The demo roster, built with the same shape lib/store.ts expects. Passwords are the single word "demo":
// there is no server here to hash against, and nothing real to protect.
function demoSeed(){
  const people=[
    ["requester@woodcraft.demo","Robin","Diaz","REQUESTER",null,null,"District 4","Central High School"],
    ["manager@woodcraft.demo","Marcus","Lee","APPROVER","MANAGER",null,"Woodcraft","Operations"],
    ["director@woodcraft.demo","Ana","Rivera","APPROVER","DIRECTOR",null,"Woodcraft","Programs"],
    ["chief@woodcraft.demo","Daniel","Okafor","APPROVER","CHIEF",null,"Woodcraft","Executive"],
    ["finance@woodcraft.demo","Tomas","Reyes","FINANCE_REVIEWER",null,null,"Woodcraft","Finance"],
    ["financeadmin@woodcraft.demo","Elena","Petrov","FINANCE_ADMIN",null,null,"Woodcraft","Finance"],
    ["auditor@woodcraft.demo","Nadia","Reid","VIEW_ONLY",null,"AUDITOR","Woodcraft","External Audit"],
    ["bookkeeper@woodcraft.demo","Ben","Ortiz","VIEW_ONLY",null,"BOOKKEEPER","Woodcraft","Finance"],
  ];
  const title=value=>value.replace(/_/g," ").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  const label=(role,tier,viewer)=>tier?`${title(tier)} (Approver)`
    :viewer?`${title(viewer)} (View Only)`
    :role==="FINANCE_REVIEWER"?"Finance Reviewer":role==="FINANCE_ADMIN"?"Finance Administrator":"Requester";
  const users=people.map(([email,firstName,lastName,role,tier,viewer,district,school],index)=>({
    id:`demo-${index+1}`,email,firstName,lastName,name:`${firstName} ${lastName}`,contactEmail:email,
    role,...(tier?{tier}:{}),...(viewer?{viewer}:{}),district,school,passwordHash:"",
  }));
  const accounts=people.map(([email,,,role,tier,viewer])=>({label:label(role,tier,viewer),email,password:"demo"}));
  return {users,accounts};
}

async function stylesheet(){
  const dir=at("design-system","src","styles");
  const entry=await fs.readFile(path.join(dir,"styles.css"),"utf8");
  const order=[...entry.matchAll(/@import "\.\/(.+?)"/g)].map(m=>m[1]);
  if(!order.length) throw new Error("styles.css declares no @import layers");
  const layers=await Promise.all(order.map(file=>fs.readFile(path.join(dir,file),"utf8")));
  return layers.join("");
}

async function appBundle(options){
  const outfile=path.join(tmp,"app.js");
  const shim=name=>at("scripts","browser-shims",name);
  await build({entryPoints:[at("scripts","standalone-entry.tsx")],outfile,bundle:true,platform:"browser",format:"iife",target:["chrome109","edge109","firefox115","safari16"],jsx:"automatic",minify:true,legalComments:"none",
    // The store is written for Node; these four swaps are the whole of what the browser needs, which is
    // why the demo can run the real rules instead of a reimplementation of them.
    alias:{"server-only":shim("empty.js"),"node:fs/promises":shim("node-fs.js"),"node:path":shim("node-path.js"),"node:crypto":shim("node-crypto.js")},
    define:{"process.env.NODE_ENV":'"production"',"process.env.PRF_STORE_PATH":'""',__ACCOUNTING_PAYLOAD__:JSON.stringify({site:"All FY27 sites",scope:"all",options}),__DEMO_SEED__:JSON.stringify(demoSeed())},
    logLevel:"warning"});
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
  // app/globals.css is a single @import of the design system's entry point, and an @import cannot resolve
  // inside a self-contained file. Concatenate the layers in declared order, exactly as design-system's own
  // build does — the cascade in this system is load-bearing, so the order is the whole point.
  const css=await stylesheet();

  const html=shell(css,js,sites.size);
  await fs.mkdir(at("share"),{recursive:true});
  const outfile=at("share","PRF-Hub.html");
  await fs.writeFile(outfile,html);
  // A second copy where GitHub Pages can serve it directly from the repository, so the shared link needs
  // no build pipeline and no extra permissions.
  await fs.mkdir(at("docs"),{recursive:true});
  await fs.writeFile(at("docs","index.html"),html);
  step(`css ${bytes(Buffer.byteLength(css))} · js ${bytes(Buffer.byteLength(js))}`);
  step("also written to docs/index.html for the shared link");
  console.log(`\n  ✓ ${path.relative(root,outfile)} — ${bytes(Buffer.byteLength(html))}, single file, no install required\n`);
}finally{
  await fs.rm(tmp,{recursive:true,force:true});
  await fs.rm(at("scripts","noop.js"),{force:true});
}
