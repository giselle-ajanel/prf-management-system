"use client";

import type { Approval, AuditEvent, LineItem, Request, Status } from "@ds";

// The browser's half of the API contract.
//
// Every call goes through `send`, which does the three things it would be easy to forget in one of a dozen
// call sites: attach the CSRF token, notice when the server has ended the session, and turn a JSON error
// body into a thrown Error carrying the server's own message. Components never see a Response.
//
// The types below mirror what the routes return rather than importing the server's own types: lib/store.ts
// is server-only, and a shared type would tempt someone to import the module behind it into the bundle.

export type Role = "REQUESTER" | "APPROVER";

export type SessionUser = {
  name: string;
  email: string;
  role: Role;
  district: string;
  school: string;
};

export type SessionInfo = {
  authenticated: boolean;
  user?: SessionUser;
  csrfToken?: string;
  idleTimeoutMs?: number;
  reason?: string;
  message?: string;
  passwordLoginEnabled?: boolean;
};

export type WireAudit = { id: string; at: string; actorId: string; actorName: string; action: string; detail?: string };

export type WireRequest = {
  id: string;
  ownerId: string;
  requester: string;
  vendor: string;
  description: string;
  amount: number;
  status: Status;
  district: string;
  school: string;
  siteCode: string;
  fundingCode: string;
  cycle: string;
  paymentType?: string;
  expenseType?: string;
  customSite?: boolean;
  customFunding?: boolean;
  lineItems: LineItem[];
  documents: string[];
  approvals: Approval[];
  audit: WireAudit[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  approvedAt?: string;
  requesterSigned?: boolean;
  approverSigned?: boolean;
  reviewNote?: string;
};

/** Thrown when the server says the session is over, so callers can drop straight back to the login screen. */
export class SessionEndedError extends Error {
  constructor(message = "Your session has ended. Please sign in again.") {
    super(message);
    this.name = "SessionEndedError";
  }
}

let csrfToken = "";

export const setCsrfToken = (token: string) => {
  csrfToken = token || "";
};

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const mutation = (init.method || "GET") !== "GET";
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(mutation && csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(init.headers || {}),
    },
  });

  if (response.status === 401) {
    const body = await response.json().catch(() => ({}));
    throw new SessionEndedError((body as { error?: string }).error || undefined);
  }
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Something went wrong");
  return payload;
}

// ---- auth ------------------------------------------------------------------------------------------

export async function getSession(): Promise<SessionInfo> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin" });
  const info = (await response.json().catch(() => ({ authenticated: false }))) as SessionInfo;
  if (info.csrfToken) setCsrfToken(info.csrfToken);
  return info;
}

export async function login(email: string, password: string): Promise<SessionInfo> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const payload = (await response.json().catch(() => ({}))) as { user?: SessionUser; csrfToken?: string; error?: string };
  if (!response.ok) throw new Error(payload.error || "Unable to sign in");
  if (payload.csrfToken) setCsrfToken(payload.csrfToken);
  return { authenticated: true, user: payload.user, csrfToken: payload.csrfToken };
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  setCsrfToken("");
}

// ---- requests --------------------------------------------------------------------------------------

export const fetchRequests = () => send<{ requests: WireRequest[] }>("/api/requests").then(payload => payload.requests);

export const createRequest = (draft: unknown) =>
  send<{ request: WireRequest }>("/api/requests", { method: "POST", body: JSON.stringify(draft) }).then(p => p.request);

/** PUT, not PATCH: the payload is the complete set of editable fields and replaces what is stored. */
export const updateRequest = (id: string, draft: unknown) =>
  send<{ request: WireRequest }>(`/api/requests/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(draft),
  }).then(p => p.request);

export const deleteRequest = (id: string) =>
  send<{ deleted: boolean }>(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });

export const submitRequest = (id: string, signature: string) =>
  send<{ request: WireRequest }>(`/api/requests/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    body: JSON.stringify({ signature }),
  }).then(p => p.request);

export const decideRequest = (id: string, action: "approve" | "reject", comment: string, signature = "") =>
  send<{ request: WireRequest }>(`/api/requests/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ action, comment, signature }),
  }).then(p => p.request);

// ---- presentation ----------------------------------------------------------------------------------

const stamp = (iso: string | undefined) => {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const today = new Date();
  const sameDay = when.toDateString() === today.toDateString();
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : `${when.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
};

/**
 * Turns a stored record into the shape the design system renders.
 *
 * The server stores ISO timestamps because that is what a record wants; the components want display text,
 * and an audit entry's `detail` — a signature name, a return comment — becomes part of the line the trail
 * shows, so the reason a request came back is visible in its history rather than only on the request.
 */
export function toViewRequest(wire: WireRequest): Request {
  const audit: AuditEvent[] = wire.audit
    .map(entry => ({
      time: stamp(entry.at),
      event: entry.detail ? `${entry.action} — ${entry.detail}` : entry.action,
      actor: entry.actorName,
    }))
    .reverse();

  return {
    id: wire.id,
    vendor: wire.vendor,
    description: wire.description,
    amount: wire.amount,
    status: wire.status,
    district: wire.district,
    school: wire.school,
    siteCode: wire.siteCode,
    fundingCode: wire.fundingCode,
    cycle: wire.cycle,
    requester: wire.requester,
    updated: stamp(wire.updatedAt),
    lineItems: wire.lineItems,
    approvals: wire.approvals.map(approval => ({ ...approval, time: approval.time ? stamp(approval.time) : undefined })),
    audit,
    documents: wire.documents,
    approvedAt: wire.approvedAt,
    submittedAt: wire.submittedAt,
    paymentType: wire.paymentType,
    expenseType: wire.expenseType,
    customSite: wire.customSite,
    customFunding: wire.customFunding,
    reviewNote: wire.reviewNote,
    requesterSigned: wire.requesterSigned,
    approverSigned: wire.approverSigned,
  };
}
