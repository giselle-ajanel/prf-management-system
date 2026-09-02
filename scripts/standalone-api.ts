// The offline demo's backend, running inside the browser tab.
//
// It calls the real lib/store.ts — the same authorisation rules, the same two-gate state machine, the same
// append-only audit — with persistence pointed at localStorage instead of a file. Reimplementing those
// rules in the browser would have produced a demo that drifts from the product within a release; this way
// the demo is wrong only where it is honestly different.
//
// What it is NOT is a security boundary. Every check runs in the visitor's own tab, where they could edit
// it. That is fine for a demo whose entire dataset is invented, and it is why the banner on the page says
// so plainly. The hosted app enforces the same rules on a server the visitor does not control.

import {
  attachToRequest,
  configureStore,
  createDraft,
  decideRequest,
  deleteDraft,
  detachFromRequest,
  financeReview,
  findUserByEmail,
  getRequest,
  listAccountLog,
  listNotifications,
  listRequests,
  listUsers,
  markNotificationsRead,
  submitRequest,
  updateProfile,
  updateDraft,
  assignRole,
  type Actor,
  type StoredUser,
} from "../lib/store";
import { parseDraft, decisionAction } from "../lib/prf-input";
import { FieldError, id as parseId, line, optionalText, email as parseEmail } from "../lib/sanitize";

const KEY = "prf-offline-demo-v1";
const SESSION_KEY = "prf-offline-session";

/** Demo passwords are a fixed word here: there is no server to hash against and nothing real to protect. */
export const DEMO_PASSWORD = "demo";

type Json = Record<string, unknown>;

const read = (): Json | null => {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Json) : null;
  } catch {
    return null;
  }
};

const write = (database: unknown) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(database));
  } catch {
    // Quota or private mode: the demo keeps working for this tab, it just will not survive a reload.
  }
};

configureStore({
  read: async () => read() as never,
  write: async database => write(database),
});

// ---- the signed-in visitor ---------------------------------------------------------------------------

const actorFrom = (user: StoredUser): Actor => ({
  userId: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  tier: user.tier,
  viewer: user.viewer,
});

async function currentActor(): Promise<Actor | null> {
  const email = window.localStorage.getItem(SESSION_KEY);
  if (!email) return null;
  const user = await findUserByEmail(email);
  return user ? actorFrom(user) : null;
}

// ---- request plumbing --------------------------------------------------------------------------------

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const failed = (error: unknown) => {
  const named = error as { name?: string; message?: string; field?: string };
  const status =
    named?.name === "NotFoundError" ? 404 :
    named?.name === "ForbiddenError" ? 403 :
    named?.name === "ConflictError" ? 409 :
    named?.name === "FieldError" ? 400 : 500;
  return ok({ error: named?.message || "Something went wrong", field: named?.field }, status);
};

type Handler = (context: { actor: Actor | null; body: Json; id: string; fileId: string; url: URL }) => Promise<Response>;

/** Routes an /api/... path to the store, mirroring what the real route handlers do. */
const ROUTES: { method: string; pattern: RegExp; auth: boolean; run: Handler }[] = [
  {
    method: "GET", pattern: /^\/api\/auth\/session$/, auth: false,
    run: async ({ actor }) =>
      ok(actor
        ? { authenticated: true, user: { name: actor.name, email: actor.email, role: actor.role, tier: actor.tier, viewer: actor.viewer, district: "", school: "" }, csrfToken: "offline", idleTimeoutMs: 3600000 }
        : { authenticated: false, reason: "none", passwordLoginEnabled: true }),
  },
  {
    method: "POST", pattern: /^\/api\/auth\/login$/, auth: false,
    run: async ({ body }) => {
      const user = await findUserByEmail(String(body.email || ""));
      if (!user || String(body.password || "") !== DEMO_PASSWORD) {
        return ok({ error: "That email and password combination was not recognised" }, 401);
      }
      window.localStorage.setItem(SESSION_KEY, user.email);
      return ok({ user: { name: user.name, email: user.email, role: user.role, tier: user.tier, viewer: user.viewer, district: user.district, school: user.school }, csrfToken: "offline" });
    },
  },
  {
    method: "POST", pattern: /^\/api\/auth\/logout$/, auth: false,
    run: async () => {
      window.localStorage.removeItem(SESSION_KEY);
      return ok({ signedOut: true });
    },
  },
  { method: "GET", pattern: /^\/api\/requests$/, auth: true, run: async ({ actor }) => ok({ requests: await listRequests(actor!) }) },
  { method: "POST", pattern: /^\/api\/requests$/, auth: true, run: async ({ actor, body }) => ok({ request: await createDraft(actor!, parseDraft(body)) }, 201) },
  { method: "GET", pattern: /^\/api\/requests\/([^/]+)$/, auth: true, run: async ({ actor, id }) => ok({ request: await getRequest(actor!, parseId(id, "Request id")) }) },
  { method: "PUT", pattern: /^\/api\/requests\/([^/]+)$/, auth: true, run: async ({ actor, id, body }) => ok({ request: await updateDraft(actor!, parseId(id, "Request id"), parseDraft(body)) }) },
  { method: "DELETE", pattern: /^\/api\/requests\/([^/]+)$/, auth: true, run: async ({ actor, id }) => { await deleteDraft(actor!, parseId(id, "Request id")); return ok({ deleted: true }); } },
  {
    method: "POST", pattern: /^\/api\/requests\/([^/]+)\/submit$/, auth: true,
    run: async ({ actor, id, body }) => ok({ request: await submitRequest(actor!, parseId(id, "Request id"), line(body.signature, "Signature", 120)) }),
  },
  {
    method: "POST", pattern: /^\/api\/requests\/([^/]+)\/decision$/, auth: true,
    run: async ({ actor, id, body }) => {
      const action = decisionAction(body.action);
      return ok({ request: await decideRequest(actor!, parseId(id, "Request id"), { action, comment: optionalText(body.comment, "Comment", 2000), signature: action === "approve" ? line(body.signature, "Signature", 120) : "" }) });
    },
  },
  {
    method: "POST", pattern: /^\/api\/requests\/([^/]+)\/finance-review$/, auth: true,
    run: async ({ actor, id, body }) => {
      const action = decisionAction(body.action);
      return ok({ request: await financeReview(actor!, parseId(id, "Request id"), { action, comment: optionalText(body.comment, "Compliance note", 2000), signature: action === "approve" ? line(body.signature, "Signature", 120) : "" }) });
    },
  },
  { method: "GET", pattern: /^\/api\/requests\/([^/]+)\/attachments$/, auth: true, run: async ({ actor, id }) => ok({ attachments: (await getRequest(actor!, parseId(id, "Request id"))).attachments }) },
  {
    method: "DELETE", pattern: /^\/api\/requests\/([^/]+)\/attachments\/([^/]+)$/, auth: true,
    run: async ({ actor, id, fileId }) => { await detachFromRequest(actor!, parseId(id, "Request id"), fileId); return ok({ deleted: true }); },
  },
  { method: "GET", pattern: /^\/api\/notifications$/, auth: true, run: async ({ actor }) => ok({ notifications: await listNotifications(actor!) }) },
  { method: "POST", pattern: /^\/api\/notifications$/, auth: true, run: async ({ actor }) => { await markNotificationsRead(actor!); return ok({ read: true }); } },
  {
    method: "GET", pattern: /^\/api\/profile$/, auth: true,
    run: async ({ actor }) => {
      const user = await findUserByEmail(actor!.email);
      return ok({ profile: { firstName: user?.firstName || "", lastName: user?.lastName || "", email: actor!.email, contactEmail: user?.contactEmail || actor!.email, role: actor!.role, tier: actor!.tier, viewer: actor!.viewer } });
    },
  },
  {
    method: "PUT", pattern: /^\/api\/profile$/, auth: true,
    run: async ({ actor, body }) => {
      const user = await updateProfile(actor!, {
        firstName: line(body.firstName, "First name", 60),
        lastName: line(body.lastName, "Last name", 60),
        contactEmail: body.contactEmail ? parseEmail(body.contactEmail, "Contact email") : actor!.email,
      });
      return ok({ profile: { firstName: user.firstName, lastName: user.lastName, email: user.email, contactEmail: user.contactEmail, role: user.role, tier: user.tier, viewer: user.viewer } });
    },
  },
  { method: "GET", pattern: /^\/api\/users$/, auth: true, run: async ({ actor }) => { await listAccountLog(actor!); return ok({ users: await listUsers() }); } },
  {
    method: "PUT", pattern: /^\/api\/users$/, auth: true,
    run: async ({ actor, body }) => ok({ user: await assignRole(actor!, parseId(body.userId, "User id"), body.role as never) }),
  },
];

/** Installs the in-tab backend. Anything that is not an /api/ call falls through to the real fetch. */
export function installOfflineApi(demoAccounts: { label: string; email: string; password: string }[]): void {
  const original = window.fetch?.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (!url.pathname.startsWith("/api/")) {
      if (original) return original(input as RequestInfo, init);
      return new Response("", { status: 404 });
    }

    if (url.pathname === "/api/demo-accounts") return ok({ accounts: demoAccounts });

    const method = (init?.method || (typeof input !== "string" && "method" in input ? input.method : "GET") || "GET").toUpperCase();
    const route = ROUTES.find(entry => entry.method === method && entry.pattern.test(url.pathname));
    if (!route) return ok({ error: `The offline demo does not support ${method} ${url.pathname}` }, 404);

    try {
      const match = route.pattern.exec(url.pathname) || [];
      let body: Json = {};
      if (init?.body && typeof init.body === "string") {
        try { body = JSON.parse(init.body) as Json; } catch { body = {}; }
      }
      const actor = await currentActor();
      if (route.auth && !actor) return ok({ error: "Authentication required", authenticated: false }, 401);
      return await route.run({ actor, body, id: match[1] || "", fileId: match[2] || "", url });
    } catch (error) {
      return failed(error);
    }
  }) as typeof window.fetch;

  void FieldError; // referenced so the import survives tree-shaking in every build mode
}
