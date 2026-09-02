import { authenticated, json } from "@/lib/api";
import { parseDraft } from "@/lib/prf-input";
import { id as parseId } from "@/lib/sanitize";
import { deleteDraft, getRequest, updateDraft } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One PRF.
//
// Every method resolves the record through the store, which decides both whether the caller may see it and
// whether they may change it. A requester reading another requester's PRF gets 404 rather than 403: the
// existence of the record is itself something they are not entitled to learn.

export const GET = authenticated({ name: "requests.get" }, async ({ session, params }) => {
  const request = await getRequest(session, parseId(params.id, "Request id"));
  return json({ request });
});

// PUT rather than PATCH deliberately: the body is the complete set of editable fields, and whatever it
// omits is cleared. The editor always sends the whole form, and a half-body that silently blanks a
// description is a worse failure than one that is refused.
export const PUT = authenticated({ name: "requests.update", mutation: true }, async ({ session, params, body }) => {
  const request = await updateDraft(session, parseId(params.id, "Request id"), parseDraft(body));
  return json({ request });
});

export const DELETE = authenticated({ name: "requests.delete", mutation: true }, async ({ session, params }) => {
  await deleteDraft(session, parseId(params.id, "Request id"));
  return json({ deleted: true });
});
