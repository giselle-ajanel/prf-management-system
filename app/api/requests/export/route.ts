import { NextResponse } from "next/server";
import { authenticated } from "@/lib/api";
import { line } from "@/lib/sanitize";
import { listRequests, type StoredRequest } from "@/lib/store";
import { exportFilename, toCsv } from "@ds/export";
import type { Request } from "@ds/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Finance export, generated server-side and restricted to approvers.
//
// It previously ran entirely in the browser over whatever the page happened to be holding, which is fine
// for a page whose data was already the whole register. Now that a requester's browser only ever holds
// their own PRFs, generating the file here is what makes "Finance can export the register" true without
// also making "a requester can export the register" true — the role check happens before any row is read.
//
// Escaping — including the formula-injection guard on values starting =, +, - or @ — is the design
// system's csvField, reused rather than reimplemented so the two exports cannot drift.

const toExportShape = (request: StoredRequest): Request =>
  ({
    ...request,
    approvedAt: request.approvedAt,
    submittedAt: request.submittedAt,
  }) as unknown as Request;

export const GET = authenticated(
  { name: "requests.export", authority: "register" },
  async ({ session, request }) => {
    const status = line(request.nextUrl.searchParams.get("status") || "", "Status", 40, false);
    const month = line(request.nextUrl.searchParams.get("month") || "", "Month", 10, false);

    const rows = (await listRequests(session)).filter(entry => {
      if (status && entry.status !== status) return false;
      if (month && !(entry.approvedAt || "").startsWith(month)) return false;
      return true;
    });

    const filename = exportFilename({ status, month, prefix: "PRF-register" });
    return new NextResponse(toCsv(rows.map(toExportShape)), {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      },
    });
  },
);
