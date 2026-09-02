import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { ROLE_LABEL, TIER_LABEL, VIEWER_LABEL, listUsers, storeDirectory } from "./store";

// The sign-in cheat sheet shown on the login page.
//
// Demo passwords are generated per install and written beside the store, so the page cannot know them
// without reading that file — which is exactly why this is refused outside development. In production the
// list is empty and the login page shows nothing, whatever the client asks for.

export type DemoAccount = { label: string; email: string; password: string };

const enabled = () =>
  process.env.NODE_ENV !== "production" || process.env.PRF_SHOW_DEMO_ACCOUNTS === "true";

/** Reads the generated credentials file and pairs each address with the role it belongs to. */
export async function demoAccounts(): Promise<DemoAccount[]> {
  if (!enabled()) return [];
  let text = "";
  try {
    text = await fs.readFile(path.join(storeDirectory(), "seed-credentials.txt"), "utf8");
  } catch {
    return [];
  }

  const passwords = new Map<string, string>();
  for (const row of text.split(String.fromCharCode(10))) {
    const match = /^\s*[A-Z_/]+\s+(\S+@\S+)\s+(\S+)\s*$/.exec(row);
    if (match) passwords.set(match[1].toLowerCase(), match[2]);
  }

  const users = await listUsers();
  return users
    .filter(user => passwords.has(user.email.toLowerCase()))
    .map(user => ({
      label:
        user.role === "APPROVER" && user.tier
          ? `${TIER_LABEL[user.tier]} (Approver)`
          : user.role === "VIEW_ONLY" && user.viewer
            ? `${VIEWER_LABEL[user.viewer]} (View Only)`
            : ROLE_LABEL[user.role],
      email: user.email,
      password: passwords.get(user.email.toLowerCase()) || "",
    }))
    // Requester first, then up the ladder, then Finance, then the viewers — the order people try them in.
    .sort((a, b) => ORDER.indexOf(rank(a.label)) - ORDER.indexOf(rank(b.label)));
}

const ORDER = ["requester", "approver", "finance", "view"];
const rank = (label: string) =>
  /Approver/.test(label) ? "approver" : /Finance/.test(label) ? "finance" : /View Only/.test(label) ? "view" : "requester";
