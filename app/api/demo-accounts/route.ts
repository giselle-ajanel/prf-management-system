import { json } from "@/lib/api";
import { demoAccounts } from "@/lib/demo-accounts";
import { ensureSeeded } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The demo cheat sheet, for the login page. Empty outside development — see lib/demo-accounts.ts.

export async function GET() {
  try {
    await ensureSeeded();
    return json({ accounts: await demoAccounts() });
  } catch (error) {
    console.error("demo accounts failed:", error);
    return json({ accounts: [] });
  }
}
