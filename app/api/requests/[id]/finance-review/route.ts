import { authenticated, json } from "@/lib/api";
import { decisionAction } from "@/lib/prf-input";
import { BUDGETS } from "@/lib/ratelimit";
import { id as parseId, line, optionalText } from "@/lib/sanitize";
import { financeReview } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gate 2: Finance clears a request for payment, or returns it with a compliance note.
//
// Restricted to Finance at the route and again in the store, and reachable only for a request an approver
// has already signed — a request still at gate 1 is refused there, not hidden here.

export const POST = authenticated(
  { name: "requests.finance", mutation: true, authority: "finance", budget: BUDGETS.submit },
  async ({ session, params, body }) => {
    const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const action = decisionAction(payload.action);
    const request = await financeReview(session, parseId(params.id, "Request id"), {
      action,
      comment: optionalText(payload.comment, "Compliance note", 2000),
      signature: action === "approve" ? line(payload.signature, "Signature", 120) : "",
    });
    return json({ request });
  },
);
