// Entry point for the single-file shareable build (scripts/build-standalone.mjs).
//
// It mounts the real app/page.tsx untouched and stands the backend up inside the tab: scripts/standalone-api
// routes /api/... to the very same lib/store.ts the server uses, with persistence pointed at localStorage.
// The FY27 accounting rows are baked in at build time from the same reader the live API uses.
import { createRoot } from "react-dom/client";
import PurchaseRequestHub from "../app/page";
import { DEMO_PASSWORD, installOfflineApi } from "./standalone-api";
import { configureStore } from "../lib/store";

declare const __ACCOUNTING_PAYLOAD__: { site: string; scope: string; options: unknown[] };
declare const __DEMO_SEED__: { users: unknown[]; accounts: { label: string; email: string; password: string }[] };

const KEY = "prf-offline-demo-v1";

// First visit in this browser: lay down the demo accounts. Afterwards the tab's own saved data wins, so a
// request created here is still here tomorrow.
function seedOnce() {
  try {
    if (window.localStorage.getItem(KEY)) return;
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, users: __DEMO_SEED__.users, requests: [], notifications: [], accountLog: [], revoked: [] }),
    );
  } catch {
    // Private mode: the demo runs from memory for this tab only.
  }
}

seedOnce();
installOfflineApi(__DEMO_SEED__.accounts.map(account => ({ ...account, password: DEMO_PASSWORD })));

const accounting = __ACCOUNTING_PAYLOAD__;
const originalFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (href.includes("/api/accounting-codes")) {
    return Promise.resolve(new Response(JSON.stringify(accounting), { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  return originalFetch(input as RequestInfo, init);
}) as typeof window.fetch;

// configureStore is called by standalone-api on import; referenced here so the dependency is explicit.
void configureStore;

const container = document.getElementById("root");
if (container) createRoot(container).render(<PurchaseRequestHub />);
