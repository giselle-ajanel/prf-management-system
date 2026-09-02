import { authenticated, json } from "@/lib/api";
import { decisionAction } from "@/lib/prf-input";
import { BUDGETS } from "@/lib/ratelimit";
import { id as parseId, line, optionalText } from "@/lib/sanitize";
import { decideRequest } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Approve or send back. Restricted to the approver role at the route boundary and again inside the store.
//
// Note what this endpoint does not accept: line items, amounts, vendor, coding. An approver's decision is
// approve or return-with-a-reason, and the record they authorise is the one the requester wrote — so there
// is no parameter here through which the reviewed content could be edited.

export const POST = authenticated(
  { name: "requests.decision", mutation: true, roles: ["APPROVER"], budget: BUDGETS.submit },
  async ({ session, params, body }) => {
    const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const action = decisionAction(payload.action);
    const request = await decideRequest(session, parseId(params.id, "Request id"), {
      action,
      comment: optionalText(payload.comment, "Comment", 2000),
      signature: action === "approve" ? line(payload.signature, "Signature", 120) : "",
    });
    return json({ request });
  },
);
