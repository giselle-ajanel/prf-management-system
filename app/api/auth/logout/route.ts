import { type NextRequest } from "next/server";
import { json } from "@/lib/api";
import { SESSION_COOKIE, clearSessionCookies, endSession, readSessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sign-out.
//
// Clearing the cookie alone would leave a perfectly valid signed token in whatever copied it, so the sid
// is revoked server-side as well: replaying the old cookie afterwards fails the revocation check rather
// than resuming the session. Deliberately forgiving about its input — a token that is already invalid
// still returns 200, because "sign me out" should never fail in a way that leaves someone signed in.
//
// This is the one mutation without a CSRF token, and that is the reason: the worst a forged request can
// achieve is ending the victim's own session, while requiring a token would mean a session the server has
// already stopped trusting could not be cleared down cleanly.

export async function POST(request: NextRequest) {
  try {
    const check = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
    if (check.ok) await endSession(check.session);
  } catch (error) {
    console.error("logout failed:", error);
  }
  return clearSessionCookies(json({ signedOut: true }));
}
