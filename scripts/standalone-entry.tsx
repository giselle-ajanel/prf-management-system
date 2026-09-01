// Entry point for the single-file shareable build (scripts/build-standalone.mjs).
// It mounts the real app/page.tsx component untouched and only replaces the one server dependency —
// the /api/accounting-codes route — with the FY27 rows baked in at build time. Everything else in the
// app (drafts, signatures, routing, approvals, PDF export) is already client-side and runs unchanged.
import { createRoot } from "react-dom/client";
import PurchaseRequestHub from "../app/page";

declare const __ACCOUNTING_PAYLOAD__:{site:string;scope:string;options:unknown[]};

const payload=__ACCOUNTING_PAYLOAD__;
const realFetch=typeof window.fetch==="function"?window.fetch.bind(window):undefined;
window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  if(url.includes("/api/accounting-codes")) return Promise.resolve(new Response(JSON.stringify(payload),{status:200,headers:{"Content-Type":"application/json"}}));
  if(realFetch) return realFetch(input as RequestInfo,init);
  return Promise.reject(new Error(`Offline build cannot request ${url}`));
}) as typeof window.fetch;

const container=document.getElementById("root");
if(container) createRoot(container).render(<PurchaseRequestHub/>);
