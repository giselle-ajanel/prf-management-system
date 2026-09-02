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

export type Role = "REQUESTER" | "APPROVER" | "FINANCE_REVIEWER" | "FINANCE_ADMIN" | "VIEW_ONLY";
export type Tier = "MANAGER" | "DIRECTOR" | "SENIOR_DIRECTOR" | "CHIEF" | "CFO" | "CEO";

/** Mirrors the server's taxonomy so the interface can label a role and hide what it cannot use. */
export const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: "Requester",
  APPROVER: "Approver",
  FINANCE_REVIEWER: "Finance Reviewer",
  FINANCE_ADMIN: "Finance Administrator",
  VIEW_ONLY: "View Only",
};

export const TIER_LABELS: Record<Tier, string> = {
  MANAGER: "Manager",
  DIRECTOR: "Director",
  SENIOR_DIRECTOR: "Senior Director",
  CHIEF: "Chief",
  CFO: "CFO",
  CEO: "CEO",
};

export const TIER_LIMITS: Record<Tier, number> = {
  MANAGER: 5000, DIRECTOR: 15000, SENIOR_DIRECTOR: 25000, CHIEF: 75000,
  CFO: Infinity, CEO: Infinity,
};

export const canRequest = (role: Role) => role !== "VIEW_ONLY";
export const isApprover = (role: Role) => role === "APPROVER";
export const isFinance = (role: Role) => role === "FINANCE_REVIEWER" || role === "FINANCE_ADMIN";
export const isAdmin = (role: Role) => role === "FINANCE_ADMIN";
export const seesRegister = (role: Role) => role !== "REQUESTER";

/** How a role's name reads next to a person's: "Jane Doe — Director" for an approver with a tier. */
export const positionLabel = (role: Role, tier?: Tier) =>
  role === "APPROVER" && tier ? TIER_LABELS[tier] : ROLE_LABELS[role];

export type SessionUser = {
  name: string;
  email: string;
  role: Role;
  tier?: Tier;
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
  copyName?: string;
  copyEmail?: string;
  lineItems: LineItem[];
  documents: string[];
  attachments?: { id: string; name: string; size: number; type: string }[];
  approvals: Approval[];
  audit: WireAudit[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  approvedAt?: string;
  requesterSigned?: boolean;
  approverSigned?: boolean;
  approverName?: string;
  financeSigned?: boolean;
  financeName?: string;
  completedAt?: string;
  requiredTier?: Tier;
  returnedStage?: "supervisor" | "finance";
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

/**
 * `background: true` marks a request the application made on its own — the editor's periodic autosave with
 * nobody at the keyboard. The server serves it normally but does not treat it as activity, so housekeeping
 * cannot keep an unattended session alive.
 */
type SendOptions = RequestInit & { background?: boolean };

async function send<T>(path: string, init: SendOptions = {}): Promise<T> {
  const { background, ...request } = init;
  const mutation = (request.method || "GET") !== "GET";
  const response = await fetch(path, {
    ...request,
    credentials: "same-origin",
    headers: {
      ...(request.body ? { "Content-Type": "application/json" } : {}),
      ...(mutation && csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(background ? { "x-prf-background": "1" } : {}),
      ...(request.headers || {}),
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

export const createRequest = (draft: unknown, background = false) =>
  send<{ request: WireRequest }>("/api/requests", { method: "POST", body: JSON.stringify(draft), background }).then(p => p.request);

/** PUT, not PATCH: the payload is the complete set of editable fields and replaces what is stored. */
export const updateRequest = (id: string, draft: unknown, background = false) =>
  send<{ request: WireRequest }>(`/api/requests/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(draft),
    background,
  }).then(p => p.request);

export const deleteRequest = (id: string) =>
  send<{ deleted: boolean }>(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });

export const submitRequest = (id: string, signature: string) =>
  send<{ request: WireRequest }>(`/api/requests/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    body: JSON.stringify({ signature }),
  }).then(p => p.request);

/** Gate 2: Finance clears for payment or returns with a compliance note. */
export const financeReview = (id: string, action: "approve" | "reject", comment: string, signature = "") =>
  send<{ request: WireRequest }>(`/api/requests/${encodeURIComponent(id)}/finance-review`, {
    method: "POST",
    body: JSON.stringify({ action, comment, signature }),
  }).then(p => p.request);

/** Gate 1: the supervisor signs, which sends the request on to Finance rather than finishing it. */
export const decideRequest = (id: string, action: "approve" | "reject", comment: string, signature = "") =>
  send<{ request: WireRequest }>(`/api/requests/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ action, comment, signature }),
  }).then(p => p.request);

// ---- profile, directory, notifications, attachments -------------------------------------------------

export type Profile = {
  firstName: string; lastName: string; email: string; contactEmail: string;
  role: Role; tier?: Tier; district?: string; school?: string;
};

export const getProfile = () => send<{ profile: Profile }>("/api/profile").then(p => p.profile);

export const saveProfile = (fields: { firstName: string; lastName: string; contactEmail: string }) =>
  send<{ profile: Profile }>("/api/profile", { method: "PUT", body: JSON.stringify(fields) }).then(p => p.profile);

export type DirectoryUser = { id: string; name: string; email: string; contactEmail: string; role: Role; tier?: Tier };

export const listUsers = () => send<{ users: DirectoryUser[] }>("/api/users").then(p => p.users);

export const assignRole = (userId: string, role: string) =>
  send<{ user: DirectoryUser }>("/api/users", { method: "PUT", body: JSON.stringify({ userId, role }) }).then(p => p.user);

export type ServerNotification = {
  id: string; at: string; kind: "submitted" | "approved" | "returned";
  requestId: string; title: string; body: string; read: boolean;
};

export const fetchNotifications = () =>
  send<{ notifications: ServerNotification[] }>("/api/notifications").then(p => p.notifications);

export const markNotificationsRead = () =>
  send<{ read: boolean }>("/api/notifications", { method: "POST", body: JSON.stringify({}) });

/** Uploads one file. Multipart, so the browser sets its own boundary — no Content-Type header from us. */
export async function uploadAttachment(requestId: string, file: File): Promise<WireRequest> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/attachments`, {
    method: "POST",
    credentials: "same-origin",
    headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
    body,
  });
  if (response.status === 401) throw new SessionEndedError();
  const payload = (await response.json().catch(() => ({}))) as { request?: WireRequest; error?: string };
  if (!response.ok || !payload.request) throw new Error(payload.error || "That file could not be attached");
  return payload.request;
}

export const removeAttachment = (requestId: string, fileId: string) =>
  send<{ deleted: boolean }>(
    `/api/requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );

export const attachmentUrl = (requestId: string, fileId: string) =>
  `/api/requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(fileId)}`;

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
    // Components render document names; the ids they came from stay on the wire record.
    documents: (wire.attachments || []).map(file => file.name),
    approvedAt: wire.approvedAt,
    submittedAt: wire.submittedAt,
    paymentType: wire.paymentType,
    expenseType: wire.expenseType,
    customSite: wire.customSite,
    customFunding: wire.customFunding,
    reviewNote: wire.reviewNote,
    requesterSigned: wire.requesterSigned,
    approverSigned: wire.approverSigned,
    approverName: wire.approverName,
    financeName: wire.financeName,
    completedAt: wire.completedAt,
  };
}
