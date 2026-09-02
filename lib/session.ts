import "server-only";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextResponse } from "next/server";
import { isRevoked, revokeSession, type Role } from "./store";

// Session tokens.
//
// A signed, http-only cookie carrying the identity the request acts as. Http-only is the load-bearing
// part: page script cannot read it, so an XSS bug cannot walk off with a session. The signature means the
// server never has to look the token up to know it has not been edited — but sign-out and the idle rule
// both need server state, so the store keeps a revocation list and the token carries its own last-seen
// stamp.
//
// The 1-hour idle timeout is enforced here, on every authenticated request. The browser also runs its own
// countdown so the user sees a dialog rather than a silent failure, but that countdown is a courtesy: a
// client with the timer patched out still gets refused by this module.

export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;      // 1 hour of inactivity ends the session
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // and no session outlives one working day
export const SESSION_COOKIE = "prf_session";
export const CSRF_COOKIE = "prf_csrf";

export type Session = {
  sid: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  district: string;
  school: string;
  issuedAt: number;
  lastSeen: number;
  csrf: string;
};

// ---- signing key -----------------------------------------------------------------------------------

let cachedSecret = "";

/**
 * In production the key must be supplied; a generated one would invalidate every session on deploy and,
 * worse, differ between instances behind a load balancer. In development it is generated once and kept in
 * .secure-data/ so restarting `next dev` does not sign everyone out.
 */
function secret(): string {
  if (cachedSecret) return cachedSecret;
  const configured = process.env.PRF_SESSION_SECRET || "";
  if (configured.length >= 32) {
    cachedSecret = configured;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PRF_SESSION_SECRET must be set (32+ characters) in production");
  }
  const file = path.join(process.cwd(), ".secure-data", "session-secret");
  try {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
  } catch {
    cachedSecret = randomBytes(48).toString("hex");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  }
  return cachedSecret;
}

// ---- encoding --------------------------------------------------------------------------------------

const toBase64Url = (value: Buffer | string) =>
  (typeof value === "string" ? Buffer.from(value, "utf8") : value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const fromBase64Url = (value: string) =>
  Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");

const sign = (payload: string) => toBase64Url(createHmac("sha256", secret()).update(payload).digest());

function signatureMatches(payload: string, provided: string): boolean {
  const expected = Buffer.from(sign(payload), "utf8");
  const actual = Buffer.from(provided, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function encodeSession(session: Session): string {
  const payload = toBase64Url(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

/** Signature and shape only. Expiry and revocation are checked by readSession, which can await the store. */
function decodeSession(token: string): Session | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!signatureMatches(parts[0], parts[1])) return null;
  try {
    const session = JSON.parse(fromBase64Url(parts[0])) as Session;
    const shaped =
      typeof session.sid === "string" &&
      typeof session.userId === "string" &&
      (session.role === "REQUESTER" || session.role === "APPROVER") &&
      Number.isFinite(session.issuedAt) &&
      Number.isFinite(session.lastSeen);
    return shaped ? session : null;
  } catch {
    return null;
  }
}

// ---- lifecycle -------------------------------------------------------------------------------------

export type NewSession = { session: Session; token: string };

export function startSession(user: {
  id: string;
  email: string;
  name: string;
  role: Role;
  district: string;
  school: string;
}): NewSession {
  const stamp = Date.now();
  const session: Session = {
    sid: randomUUID(),
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    district: user.district,
    school: user.school,
    issuedAt: stamp,
    lastSeen: stamp,
    csrf: randomBytes(24).toString("hex"),
  };
  return { session, token: encodeSession(session) };
}

export type SessionCheck =
  | { ok: true; session: Session; token: string }
  | { ok: false; reason: "none" | "invalid" | "idle" | "expired" | "revoked" };

/**
 * Validates the cookie and, for a user-driven request, slides the idle window forward.
 *
 * The returned token carries a refreshed lastSeen, which the caller writes back on the response — so
 * activity extends the session and inactivity ends it, without a server-side session table.
 *
 * `slide: false` validates without extending. That distinction is what makes the idle rule mean anything
 * while a PRF editor is open: the editor autosaves every 30 seconds whether or not anyone is at the
 * keyboard, and counting those saves as activity would keep an unattended browser signed in until the
 * 12-hour absolute cap. Background saves still write their content — they simply stop the clock from
 * being reset by the application's own housekeeping.
 *
 * The client decides which of its requests were user-driven, and a modified client could lie. That is
 * accepted: whoever can lie about it already holds a valid session and could keep it alive by making
 * requests directly. The rule protects an unattended browser, not against the person holding the session.
 */
export async function readSessionToken(
  token: string | undefined,
  options: { slide?: boolean } = {},
): Promise<SessionCheck> {
  if (!token) return { ok: false, reason: "none" };
  const session = decodeSession(token);
  if (!session) return { ok: false, reason: "invalid" };

  const stamp = Date.now();
  if (stamp - session.lastSeen > IDLE_TIMEOUT_MS) return { ok: false, reason: "idle" };
  if (stamp - session.issuedAt > ABSOLUTE_TIMEOUT_MS) return { ok: false, reason: "expired" };
  if (await isRevoked(session.sid)) return { ok: false, reason: "revoked" };

  if (options.slide === false) return { ok: true, session, token: encodeSession(session) };
  const refreshed: Session = { ...session, lastSeen: stamp };
  return { ok: true, session: refreshed, token: encodeSession(refreshed) };
}

/** Sign-out. Revoking the sid means a copied cookie dies with the session rather than outliving it. */
export async function endSession(session: Session): Promise<void> {
  await revokeSession(session.sid, session.issuedAt + ABSOLUTE_TIMEOUT_MS);
}

// ---- cookies ---------------------------------------------------------------------------------------

const secureCookies = () => process.env.NODE_ENV === "production";

/**
 * Writes both cookies.
 *
 * The session cookie is http-only. The CSRF cookie deliberately is not: the double-submit check needs page
 * script to read it and echo it in a header, and a value that only proves same-origin script sent the
 * request does not need to be secret from that script.
 */
export function applySession(response: NextResponse, token: string, csrf: string): NextResponse {
  const common = { sameSite: "lax" as const, secure: secureCookies(), path: "/" };
  response.cookies.set(SESSION_COOKIE, token, { ...common, httpOnly: true, maxAge: ABSOLUTE_TIMEOUT_MS / 1000 });
  response.cookies.set(CSRF_COOKIE, csrf, { ...common, httpOnly: false, maxAge: ABSOLUTE_TIMEOUT_MS / 1000 });
  return response;
}

export function clearSessionCookies(response: NextResponse): NextResponse {
  const common = { sameSite: "lax" as const, secure: secureCookies(), path: "/", maxAge: 0 };
  response.cookies.set(SESSION_COOKIE, "", { ...common, httpOnly: true });
  response.cookies.set(CSRF_COOKIE, "", { ...common, httpOnly: false });
  return response;
}
