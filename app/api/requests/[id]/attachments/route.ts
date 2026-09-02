import { NextResponse } from "next/server";
import { authenticated, errorResponse, json } from "@/lib/api";
import { BUDGETS } from "@/lib/ratelimit";
import { FieldError, id as parseId } from "@/lib/sanitize";
import { attachToRequest, getRequest } from "@/lib/store";
import { MAX_UPLOAD_BYTES, validateUpload, writeAttachment } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Uploading a supporting document.
//
// The body is multipart rather than JSON, so this route reads the form itself instead of using the
// wrapper's JSON parsing — everything else (session, CSRF, rate limit, role) still comes from the wrapper.

export const GET = authenticated({ name: "attachments.list" }, async ({ session, params }) => {
  const request = await getRequest(session, parseId(params.id, "Request id"));
  return json({ attachments: request.attachments });
});

export const POST = authenticated(
  { name: "attachments.upload", mutation: true, budget: BUDGETS.submit },
  async ({ session, request, params }) => {
    try {
      const id = parseId(params.id, "Request id");
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new FieldError("File", "Choose a file to attach.");
      if (file.size > MAX_UPLOAD_BYTES) {
        // Checked before reading the bytes, so an oversized upload is refused without buffering it.
        throw new FieldError("File", `${file.name} is larger than 10 MB. Attach a smaller copy.`);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const accepted = validateUpload({ name: file.name, type: file.type, size: file.size }, bytes);
      const stored = await writeAttachment(id, accepted, session.name);
      const updated = await attachToRequest(session, id, stored);
      return json({ request: updated, attachment: stored }, { status: 201 });
    } catch (error) {
      return errorResponse(error, "attachments.upload") as NextResponse;
    }
  },
);
