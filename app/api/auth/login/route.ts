import { NextResponse, type NextRequest } from "next/server";
import { json } from "@/lib/api";
import { verifyPassword } from "@/lib/password";
import { BUDGETS, forget, overLimit } from "@/lib/ratelimit";
import { FieldError, email as parseEmail } from "@/lib/sanitize";
import { ensureSeeded } from "@/lib/seed";
import { findUserByEmail } from "@/lib/store";
import { applySession, startSession } from "@/lib/session";

export const runtime = "nodejs";

// Password sign-in for the development and demo path.
//
// Production identity comes from the SSO proxy, so this endpoint refuses to run there unless
// PRF_ALLOW_PASSWORD_LOGIN is set deliberately. Two things it is careful about: every failure returns the
// same message and takes the same work regardless of whether the account exists, and the rate limit is
// keyed on both the address and the account so neither a single client nor a distributed attempt against
// one mailbox gets unlimited guesses.

const GENERIC_FAILURE = "That email and password combination was not recognised";

const clientKey = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production" && process.env.PRF_ALLOW_PASSWORD_LOGIN !== "true") {
      return json({ error: "Password sign-in is disabled. Use your organisation's single sign-on." }, { status: 403 });
    }
    await ensureSeeded();

    const raw = await request.text();
    if (raw.length > 4096) return json({ error: "Request body too large" }, { status: 413 });
    let payload: { email?: unknown; password?: unknown };
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    const address = parseEmail(payload.email);
    const secret = typeof payload.password === "string" ? payload.password : "";
    if (!secret) throw new FieldError("Password", "Enter your password");

    const byAddress = overLimit(`login:ip:${clientKey(request)}`, BUDGETS.login);
    const byAccount = overLimit(`login:user:${address}`, BUDGETS.login);
    const retryAfter = byAddress || byAccount;
    if (retryAfter) {
      return json(
        { error: "Too many sign-in attempts. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const user = await findUserByEmail(address);
    // verifyPassword runs a derivation even when the account is unknown, so the response time does not
    // separate "no such user" from "wrong password".
    const valid = await verifyPassword(secret, user?.passwordHash);
    if (!user || !valid || !user.passwordHash) {
      return json({ error: GENERIC_FAILURE }, { status: 401 });
    }

    forget(`login:ip:${clientKey(request)}`);
    forget(`login:user:${address}`);

    const { session, token } = startSession(user);
    const response = json({
      user: { name: user.name, email: user.email, role: user.role, district: user.district, school: user.school },
      csrfToken: session.csrf,
    });
    return applySession(response as NextResponse, token, session.csrf);
  } catch (error) {
    // A malformed address or empty password is a client mistake, not a server fault.
    if (error instanceof FieldError) return json({ error: error.message, field: error.field }, { status: 400 });
    console.error("login failed:", error);
    return json({ error: "Unable to sign in right now" }, { status: 500 });
  }
}

export function GET() {
  return json({ error: "Method not allowed" }, { status: 405 });
}

export const dynamic = "force-dynamic";
