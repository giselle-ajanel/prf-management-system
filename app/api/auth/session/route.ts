import { NextResponse, type NextRequest } from "next/server";
import { json } from "@/lib/api";
import { optionalIdentity } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";
import { findUserByEmail, upsertUser } from "@/lib/store";
import {
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
  applySession,
  clearSessionCookies,
  readSessionToken,
  startSession,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Who am I? The client calls this on load to decide between the application and the login screen, and the
// answer also hands back the CSRF token every later mutation has to echo.
//
// A 200 with authenticated:false is deliberate: "you are not signed in" is a successful answer to this
// question, and using 401 here would make the browser console noisy on every first visit.

export async function GET(request: NextRequest) {
  try {
    await ensureSeeded();
    const check = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);

    if (check.ok) {
      const response = json({
        authenticated: true,
        user: {
          name: check.session.name,
          email: check.session.email,
          role: check.session.role,
          district: check.session.district,
          school: check.session.school,
        },
        csrfToken: check.session.csrf,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
      });
      return applySession(response as NextResponse, check.token, check.session.csrf);
    }

    // Behind SSO the proxy has already authenticated the visitor, so there is nothing to log in to: mint
    // the session here and the client never sees the login screen.
    const identity = await optionalIdentity();
    if (identity) {
      const existing = await findUserByEmail(identity.email);
      const user =
        existing ||
        (await upsertUser({
          id: `sso-${Buffer.from(identity.email).toString("hex").slice(0, 24)}`,
          email: identity.email,
          name: identity.name,
          role: "REQUESTER",
          district: identity.district,
          school: identity.school,
          passwordHash: "",
        }));
      const started = startSession(user);
      const response = json({
        authenticated: true,
        user: { name: user.name, email: user.email, role: user.role, district: user.district, school: user.school },
        csrfToken: started.session.csrf,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
      });
      return applySession(response as NextResponse, started.token, started.session.csrf);
    }

    const ended = check.reason === "idle" || check.reason === "expired" || check.reason === "revoked";
    return clearSessionCookies(
      json({
        authenticated: false,
        reason: check.reason,
        message: ended ? "Your session ended after an hour of inactivity. Please sign in again." : "",
        passwordLoginEnabled:
          process.env.NODE_ENV !== "production" || process.env.PRF_ALLOW_PASSWORD_LOGIN === "true",
      }),
    );
  } catch (error) {
    console.error("session lookup failed:", error);
    return json({ authenticated: false, reason: "error" }, { status: 500 });
  }
}
