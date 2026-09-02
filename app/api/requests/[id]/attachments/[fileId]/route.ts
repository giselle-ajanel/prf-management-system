import { NextResponse } from "next/server";
import { authenticated, json } from "@/lib/api";
import { id as parseId } from "@/lib/sanitize";
import { detachFromRequest, getAttachment } from "@/lib/store";
import { readAttachment, removeAttachment } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reading and removing one attachment.
//
// The download is gated by the same visibility rule as the PRF itself, so a receipt is readable by its
// author, by anyone with signing authority, and by Finance — and by nobody else, even with the file's id.

export const GET = authenticated({ name: "attachments.read" }, async ({ session, request, params }) => {
  const requestId = parseId(params.id, "Request id");
  const attachment = await getAttachment(session, requestId, parseId(params.fileId, "File id"));
  const bytes = await readAttachment(requestId, attachment.id);
  // An image may be shown in the browser; a PDF is always downloaded. A PDF can carry script, and there is
  // nothing to gain from rendering one inside this application's own origin — the sandbox header below
  // blocks it anyway, which would simply produce a blank tab.
  const previewable = attachment.type === "image/png" || attachment.type === "image/jpeg";
  const inline = previewable && request.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${attachment.name.replace(/"/g, "")}"`,
      "Content-Length": String(attachment.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "same-origin",
    },
  });
});

export const DELETE = authenticated({ name: "attachments.delete", mutation: true }, async ({ session, params }) => {
  const requestId = parseId(params.id, "Request id");
  const removed = await detachFromRequest(session, requestId, parseId(params.fileId, "File id"));
  await removeAttachment(requestId, removed.id);
  return json({ deleted: true });
});
