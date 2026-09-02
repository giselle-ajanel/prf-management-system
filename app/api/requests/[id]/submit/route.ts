import { authenticated, json } from "@/lib/api";
import { BUDGETS } from "@/lib/ratelimit";
import { id as parseId, line } from "@/lib/sanitize";
import { submitRequest } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Submission: the requester signs and the PRF leaves their hands.
//
// Held to the submit budget rather than the general write budget — this is one of the two actions worth
// automating against, and a person does not submit twelve purchase requests a minute.

export const POST = authenticated(
  { name: "requests.submit", mutation: true, budget: BUDGETS.submit },
  async ({ session, params, body }) => {
    const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const signature = line(payload.signature, "Signature", 120);
    const request = await submitRequest(session, parseId(params.id, "Request id"), signature);
    return json({ request });
  },
);
