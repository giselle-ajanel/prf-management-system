import { authenticated, json } from "@/lib/api";
import { parseDraft } from "@/lib/prf-input";
import { ensureSeeded } from "@/lib/seed";
import { createDraft, listRequests } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The register.
//
// GET returns what the caller is entitled to see, and that filtering happens inside listRequests rather
// than here — a requester gets their own PRFs whether they ask through the UI, curl, or a saved fetch from
// a previous session as an approver.

export const GET = authenticated({ name: "requests.list" }, async ({ session }) => {
  await ensureSeeded();
  const requests = await listRequests(session);
  return json({ requests, role: session.role });
});

export const POST = authenticated({ name: "requests.create", mutation: true }, async ({ session, body }) => {
  const request = await createDraft(session, parseDraft(body));
  return json({ request }, { status: 201 });
});
