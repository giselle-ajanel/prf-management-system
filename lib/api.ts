import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { optionalIdentity } from "./auth";
import { BUDGETS, overLimit, type Budget } from "./ratelimit";
import { FieldError } from "./sanitize";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  isAdmin,
  isApprover,
  provisionFromIdentity,
  type Role,
} from "./store";
import {
  SESSION_COOKIE,
  applySession,
  clearSessionCookies,
  readSessionToken,
  startSession,
  type Session,
} from "./session";

// One place where every authenticated route resolves who is calling, whether they may call it, and what
// happens when the answer is no.
//
// Each concern is small on its own; the value is that no route can forget one. A handler wrapped by
// `authenticated` cannot run before the session is valid, the role matches, the CSRF token checks out and
// the rate limit has room — and it cannot leak an internal error message on the way out.

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

export const json = (body: unknown, init?: ResponseInit) =>
  NextResponse.json(body, { ...init, headers: { ...SECURITY_HEADERS, ...(init?.headers || {}) } });

export type Context<T = unknown> = {
  request: NextRequest;
  session: Session;
  body: T;
  params: Record<string, string>;
};

export type RouteOptions = {
  /** Roles allowed to call this route. Omitted means any authenticated user. */
  roles?: Role[];
  /**
   * Coarser gate than naming roles, so adding a position to the ladder does not mean revisiting every
   * route. "approver" is anyone with signing authority, "admin" is Finance or Administrator, and
   * "register" is either — the people entitled to see the whole book rather than their own requests.
   */
  authority?: "approver" | "admin" | "register";
  /** Mutations require a CSRF token and are held to a write budget. */
  mutation?: boolean;
  budget?: Budget;
  /** Distinguishes counters so a busy read budget cannot exhaust a submit budget. */
  name: string;
};

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Same-origin proof for state-changing requests.
 *
 * Two independent checks, because each covers the other's gap. The CSRF token lives inside the signed
 * session cookie and must be echoed in a header — a cross-site form post cannot set headers, and a
 * cross-site script cannot read the token. The Origin check then catches anything that arrives with an
 * origin that is not ours, including a request that somehow carried the header along.
 */
function csrfFailure(request: NextRequest, session: Session): string | null {
  const provided = request.headers.get("x-csrf-token") || "";
  const expected = session.csrf || "";
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return "Invalid or missing CSRF token";

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.nextUrl.host) return "Cross-origin request rejected";
    } catch {
      return "Cross-origin request rejected";
    }
  }
  return null;
}

/** Maps a thrown error onto a response. Anything unrecognised is logged server-side and reported as 500. */
export function errorResponse(error: unknown, route: string): NextResponse {
  if (error instanceof FieldError) return json({ error: error.message, field: error.field }, { status: 400 });
  if (error instanceof NotFoundError) return json({ error: error.message }, { status: 404 });
  if (error instanceof ForbiddenError) return json({ error: error.message }, { status: 403 });
  if (error instanceof ConflictError) return json({ error: error.message }, { status: 409 });
  console.error(`${route} failed:`, error);
  return json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Resolves the caller.
 *
 * A valid session cookie is the normal path. Behind SSO the proxy asserts the identity instead, and the
 * first such request mints a session so the rest of the machinery — CSRF tokens, the idle window — works
 * identically either way. An SSO identity that has never been seen is provisioned as a requester: roles
 * are granted in the store, never by a header, or anyone who could set one could promote themselves.
 */
async function resolveSession(request: NextRequest): Promise<
  { ok: true; session: Session; token: string } | { ok: false; status: number; reason: string }
> {
  // The editor's periodic autosave marks itself as background when nobody has touched the keyboard since
  // the last one. Those requests are served normally but do not reset the idle clock, so leaving a PRF
  // open on an unattended machine no longer holds the session open indefinitely.
  const background = request.headers.get("x-prf-background") === "1";
  const check = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, { slide: !background });
  if (check.ok) return check;

  const identity = await optionalIdentity();
  if (identity) {
    const user = await provisionFromIdentity(identity);
    const started = startSession(user);
    return { ok: true, session: started.session, token: started.token };
  }

  const expired = check.reason === "idle" || check.reason === "expired" || check.reason === "revoked";
  return {
    ok: false,
    status: 401,
    reason: expired ? "Your session has ended. Please sign in again." : "Authentication required",
  };
}

/** Wraps a route handler with session, role, CSRF, rate-limit and error handling. */
export function authenticated<T = unknown>(
  options: RouteOptions,
  handler: (context: Context<T>) => Promise<NextResponse> | NextResponse,
) {
  return async (request: NextRequest, segment: { params: Promise<Record<string, string>> }) => {
    try {
      const resolved = await resolveSession(request);
      if (!resolved.ok) {
        // An ended session gets its cookies cleared, so the browser stops replaying a token the server has
        // already refused and the client can redirect straight to the login screen.
        return clearSessionCookies(json({ error: resolved.reason, authenticated: false }, { status: resolved.status }));
      }
      const { session, token } = resolved;

      if (options.roles && !options.roles.includes(session.role)) {
        return json({ error: "You do not have access to this area" }, { status: 403 });
      }
      if (options.authority) {
        const allowed =
          options.authority === "approver"
            ? isApprover(session.role)
            : options.authority === "admin"
              ? isAdmin(session.role)
              : isApprover(session.role) || isAdmin(session.role);
        if (!allowed) return json({ error: "You do not have access to this area" }, { status: 403 });
      }

      if (options.mutation) {
        const failure = csrfFailure(request, session);
        if (failure) return json({ error: failure }, { status: 403 });
      }

      const budget = options.budget || (options.mutation ? BUDGETS.write : BUDGETS.read);
      const retryAfter = overLimit(`${options.name}:${session.userId}`, budget);
      if (retryAfter) {
        return json({ error: "Too many requests. Please slow down." }, {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        });
      }

      let body: T = undefined as T;
      // A multipart upload is read by its own handler, which needs the stream intact. Parsing it here
      // would consume the body and leave the handler with nothing — the bug that made every file upload
      // fail with "Request body must be valid JSON".
      const multipart = (request.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data");
      if (options.mutation && request.method !== "DELETE" && !multipart) {
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return json({ error: "Request body too large" }, { status: 413 });
        if (raw) {
          try {
            body = JSON.parse(raw) as T;
          } catch {
            return json({ error: "Request body must be valid JSON" }, { status: 400 });
          }
        }
      }

      const params = (await segment?.params) || {};
      const response = await handler({ request, session, body, params });
      return applySession(response, token, session.csrf);
    } catch (error) {
      return errorResponse(error, options.name);
    }
  };
}
