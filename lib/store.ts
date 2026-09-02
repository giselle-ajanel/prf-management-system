import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FieldError } from "./sanitize";

// The purchase-request data-access layer.
//
// Every read and every write in the application goes through this module, and every method takes the actor
// performing it. That is the point: authorisation lives here, next to the data, not in the route handlers
// and certainly not in the browser. A requester who calls the API directly with a hand-written fetch gets
// the same answer as one clicking the UI, because the check that matters happens after the request has
// already reached the data.
//
// Persistence is a JSON file under .secure-data/ (git-ignored, never under public/). It is deliberately
// behind the narrow interface below — `Repository` — so the Prisma/Postgres implementation the schema in
// prisma/ describes can replace it without any route or component changing. What the file store does not
// provide is cross-process locking: writes are serialised by an in-process queue and committed by atomic
// rename, which is correct for one Node process and is one of the reasons this is a prototype store rather
// than a production one.

/**
 * Positions in the organisation, not job titles: each one carries a signing limit or an administrative
 * privilege, and nothing else in the system asks what a person is called.
 *
 * FINANCE and ADMIN sit outside the signing ladder deliberately. They can see the whole register and
 * reassign roles, but they cannot authorise spending — administering the system and approving money are
 * different powers, and the people who hold one should not silently hold the other.
 */
export type Role =
  | "REQUESTER"
  | "MANAGER"
  | "DIRECTOR"
  | "SENIOR_DIRECTOR"
  | "CHIEF"
  | "CFO"
  | "CEO"
  | "FINANCE"
  | "ADMIN";

export const ROLES: Role[] = [
  "REQUESTER", "MANAGER", "DIRECTOR", "SENIOR_DIRECTOR", "CHIEF", "CFO", "CEO", "FINANCE", "ADMIN",
];

/** The most a position may authorise. 0 means no signing authority at all. */
const APPROVAL_LIMIT: Record<Role, number> = {
  REQUESTER: 0,
  MANAGER: 5000,
  DIRECTOR: 15000,
  SENIOR_DIRECTOR: 25000,
  CHIEF: 75000,
  CFO: Number.POSITIVE_INFINITY,
  CEO: Number.POSITIVE_INFINITY,
  FINANCE: 0,
  ADMIN: 0,
};

/** Human label for a position, used in the interface and in notification wording. */
export const ROLE_LABEL: Record<Role, string> = {
  REQUESTER: "Requester",
  MANAGER: "Manager",
  DIRECTOR: "Director",
  SENIOR_DIRECTOR: "Senior Director",
  CHIEF: "Chief",
  CFO: "CFO",
  CEO: "CEO",
  FINANCE: "Finance",
  ADMIN: "Administrator",
};

export const approvalLimit = (role: Role) => APPROVAL_LIMIT[role] ?? 0;

/** Anyone who can sign off on spending, at any level. */
export const isApprover = (role: Role) => approvalLimit(role) > 0;

/** Anyone who administers the system: the whole register, exports, and role assignment. */
export const isAdmin = (role: Role) => role === "FINANCE" || role === "ADMIN";

/** Whether this position may authorise this amount. */
export const canApprove = (role: Role, amount: number) =>
  isApprover(role) && Number.isFinite(amount) && amount > 0 && amount <= approvalLimit(role);

/**
 * Roles stored before the ladder existed read as "APPROVER". Director is the closest equivalent: it is the
 * tier the original single approver was routed requests at.
 */
export const normalizeRole = (value: unknown): Role => {
  const role = String(value || "");
  if (role === "APPROVER") return "DIRECTOR";
  return (ROLES as string[]).includes(role) ? (role as Role) : "REQUESTER";
};

export type Status = "Draft" | "Awaiting Approval" | "Returned" | "Approved";

/** Whoever is performing the operation. Structurally satisfied by a Session, so no import cycle. */
export type Actor = { userId: string; email: string; name: string; role: Role };

export type StoredUser = {
  id: string;
  /** Sign-in address. Immutable once created — changing it would change who the account is. */
  email: string;
  firstName: string;
  lastName: string;
  /** Display name, kept in step with the two name fields so every consumer has one string to read. */
  name: string;
  /** Where this person wants to be contacted, which is not always the address they sign in with. */
  contactEmail: string;
  role: Role;
  district: string;
  school: string;
  passwordHash: string;
};

/**
 * One line on a request.
 *
 * The coding fields travel with the line rather than the request: a PRF routinely splits across clubs and
 * sites, and the printed form has a column for each. They are optional because a draft is allowed to be
 * half-filled.
 */
/** One uploaded file. The bytes live beside the store; this is the record that points at them. */
export type StoredAttachment = {
  id: string;
  name: string;
  size: number;
  /** The type the server determined by inspecting the bytes, not the one the browser claimed. */
  type: string;
  uploadedAt: string;
  uploadedBy: string;
};

/** An in-app notification, addressed to an account or — for a copied-in colleague — to an address. */
export type StoredNotification = {
  id: string;
  at: string;
  kind: "submitted" | "approved" | "returned";
  requestId: string;
  title: string;
  body: string;
  userId?: string;
  email?: string;
  read: boolean;
};

export type StoredLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  expenseType?: string;
  club?: string;
  splitSite?: string;
};
export type StoredApproval = { role: string; name: string; status: string; time?: string };

/** One immutable entry in a PRF's history. Never updated, never removed — see assertAppendOnly. */
export type StoredAudit = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  detail?: string;
};

export type StoredRequest = {
  id: string;
  ownerId: string;
  requester: string;
  vendor: string;
  vendorAddress?: string;
  vendorCity?: string;
  vendorEmail?: string;
  description: string;
  /** Why a manually entered code was used. Required by policy when the coding is not from the workbook. */
  justification?: string;
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
  /** Person copied in for visibility. Notified alongside the requester, but has no rights over the PRF. */
  copyName?: string;
  copyEmail?: string;
  lineItems: StoredLine[];
  documents: string[];
  attachments: StoredAttachment[];
  approvals: StoredApproval[];
  audit: StoredAudit[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  approvedAt?: string;
  requesterSigned?: boolean;
  approverSigned?: boolean;
  requesterSignature?: string;
  approverSignature?: string;
  reviewNote?: string;
};

type Database = {
  version: number;
  users: StoredUser[];
  requests: StoredRequest[];
  notifications: StoredNotification[];
  revoked: { sid: string; expiresAt: number }[];
};

// ---- errors ----------------------------------------------------------------------------------------
// Thrown by the store, mapped to status codes in lib/api.ts. The store never returns an HTTP concern and
// the routes never make an authorisation decision; each layer does one job.

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  constructor(message = "That action is not allowed in the request's current state") {
    super(message);
    this.name = "ConflictError";
  }
}

// ---- file persistence ------------------------------------------------------------------------------

const storePath = () =>
  process.env.PRF_STORE_PATH || path.join(process.cwd(), ".secure-data", "prf-store.json");

/** Where the store lives. Anything else written alongside the data belongs in this directory too. */
export const storeDirectory = () => path.dirname(storePath());

const EMPTY: Database = { version: 1, users: [], requests: [], notifications: [], revoked: [] };

let cache: Database | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function readDatabase(): Promise<Database> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    cache = {
      version: parsed.version || 1,
      // Accounts written before the ladder and the split name fields existed are brought forward on read,
      // so an older store keeps working instead of producing users with a role nothing recognises.
      users: (Array.isArray(parsed.users) ? parsed.users : []).map(user => {
        const names = splitName(user.name || "");
        return {
          ...user,
          role: normalizeRole(user.role),
          firstName: user.firstName || names.firstName,
          lastName: user.lastName || names.lastName,
          contactEmail: user.contactEmail || user.email,
        };
      }),
      requests: (Array.isArray(parsed.requests) ? parsed.requests : []).map(request => ({
        ...request,
        // Records written before attachments existed have no array; readers should never have to guard.
        attachments: Array.isArray(request.attachments) ? request.attachments : [],
      })),
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      revoked: Array.isArray(parsed.revoked) ? parsed.revoked : [],
    };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing) throw error;
    cache = { ...EMPTY };
  }
  return cache;
}

/** Commit by atomic rename so a crash mid-write cannot leave a half-written store on disk. */
async function writeDatabase(next: Database): Promise<void> {
  const target = storePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fs.rename(temporary, target);
  cache = next;
}

/**
 * Serialises every mutation through one queue.
 *
 * Read-modify-write on a JSON file is a lost-update race the moment two requests overlap, and two requests
 * overlapping is the normal case for an approver working a queue while a requester saves a draft.
 */
function transaction<T>(work: (database: Database) => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    const database = await readDatabase();
    const draft: Database = JSON.parse(JSON.stringify(database));
    const result = await work(draft);
    assertAppendOnly(database.requests, draft.requests);
    await writeDatabase(draft);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/**
 * The audit trail is append-only, and this is where that is true rather than merely intended.
 *
 * Before any transaction commits, each request's existing audit entries must still be present, in order,
 * unchanged. A code path that edits history — or drops it while rebuilding a record — fails here instead
 * of quietly rewriting what a PRF's own history says happened.
 */
function assertAppendOnly(before: StoredRequest[], after: StoredRequest[]): void {
  for (const original of before) {
    const updated = after.find(entry => entry.id === original.id);
    if (!updated) continue; // deletion is checked by the caller's own rules, not here
    const kept = updated.audit.slice(0, original.audit.length);
    const same =
      kept.length === original.audit.length &&
      kept.every((entry, index) => entry.id === original.audit[index].id && entry.at === original.audit[index].at && entry.action === original.audit[index].action);
    if (!same) throw new Error(`audit trail for ${original.id} was modified rather than appended to`);
  }
}

/** Test seam: drops the in-process cache so a suite can point PRF_STORE_PATH somewhere new. */
export function resetStoreCache(): void {
  cache = null;
  queue = Promise.resolve();
}

// ---- status machine --------------------------------------------------------------------------------

// Legal transitions, and the only ones the store will perform. Approved is terminal, and nothing returns
// to Draft: a submitted PRF that needs work becomes Returned, which keeps the submission in its history
// rather than erasing it.
const TRANSITIONS: Record<Status, Status[]> = {
  Draft: ["Awaiting Approval"],
  Returned: ["Awaiting Approval"],
  "Awaiting Approval": ["Approved", "Returned"],
  Approved: [],
};

export function assertTransition(from: Status, to: Status): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConflictError(`A ${from} request cannot become ${to}`);
  }
}

/** Statuses whose content the owner may still change. A Returned PRF is editable so it can be fixed. */
const EDITABLE: Status[] = ["Draft", "Returned"];

// ---- helpers ---------------------------------------------------------------------------------------

const now = () => new Date().toISOString();

/** Currency for notification wording. The design system's money() is client code, so this is its twin. */
const moneyText = (amount: number) =>
  amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function auditEntry(actor: Actor, action: string, detail?: string): StoredAudit {
  return { id: randomUUID(), at: now(), actorId: actor.userId, actorName: actor.name, action, detail };
}

/** PRF numbers come from the highest issued number, never from the list length. */
function nextPrfNumber(requests: StoredRequest[]): string {
  const highest = requests.reduce((max, request) => {
    const match = /^PRF-FY27-(\d+)$/.exec(request.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `PRF-FY27-${String(highest + 1).padStart(4, "0")}`;
}

/** A requester sees only their own requests; approvers and administrators see the whole register. */
const visibleTo = (actor: Actor, request: StoredRequest) =>
  isApprover(actor.role) || isAdmin(actor.role) || request.ownerId === actor.userId;

/**
 * Locates a request the actor is allowed to know exists.
 *
 * A requester asking for someone else's PRF gets NotFound rather than Forbidden on purpose: Forbidden
 * confirms the record exists, which is exactly the fact they are not entitled to.
 */
function locate(database: Database, actor: Actor, id: string): StoredRequest {
  const request = database.requests.find(entry => entry.id === id);
  if (!request || !visibleTo(actor, request)) throw new NotFoundError("That request could not be found");
  return request;
}

// ---- input shapes ----------------------------------------------------------------------------------
// Already sanitised by the caller (lib/sanitize.ts); the store's job is the rules, not the parsing.

export type DraftInput = {
  vendor: string;
  copyName: string;
  copyEmail: string;
  vendorAddress: string;
  vendorCity: string;
  vendorEmail: string;
  description: string;
  justification: string;
  district: string;
  school: string;
  siteCode: string;
  fundingCode: string;
  paymentType: string;
  expenseType: string;
  customSite: boolean;
  customFunding: boolean;
  lineItems: StoredLine[];
  /** Absent means "leave whatever is attached alone" — an editor save must not detach a quote. */
  documents?: string[];
};

export type Decision = { action: "approve" | "reject"; comment: string; signature: string };

// ---- users -----------------------------------------------------------------------------------------

export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  const database = await readDatabase();
  return database.users.find(user => user.email.toLowerCase() === email.toLowerCase());
}

export async function findUserById(id: string): Promise<StoredUser | undefined> {
  const database = await readDatabase();
  return database.users.find(user => user.id === id);
}

export async function listUsers(): Promise<StoredUser[]> {
  return (await readDatabase()).users;
}

/** Splits a display name into first and last, keeping everything after the first space as the surname. */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

/**
 * Finds or creates the account behind an SSO identity.
 *
 * A person the proxy vouches for but the store has never seen is provisioned as a requester. Roles are
 * granted here, never asserted by a header — otherwise anyone who could set one could promote themselves.
 */
export async function provisionFromIdentity(identity: {
  email: string;
  name: string;
  district: string;
  school: string;
}): Promise<StoredUser> {
  const existing = await findUserByEmail(identity.email);
  if (existing) return existing;
  const { firstName, lastName } = splitName(identity.name);
  return upsertUser({
    id: `sso-${Buffer.from(identity.email).toString("hex").slice(0, 24)}`,
    email: identity.email,
    firstName,
    lastName,
    name: identity.name,
    contactEmail: identity.email,
    role: "REQUESTER",
    district: identity.district,
    school: identity.school,
    passwordHash: "",
  });
}

export async function upsertUser(user: StoredUser): Promise<StoredUser> {
  return transaction(database => {
    const index = database.users.findIndex(entry => entry.email.toLowerCase() === user.email.toLowerCase());
    if (index >= 0) database.users[index] = { ...database.users[index], ...user };
    else database.users.push(user);
    return user;
  });
}

// ---- session revocation ----------------------------------------------------------------------------
// Signing out has to invalidate the token itself, not just drop the cookie: a copy of a signed cookie is
// otherwise valid until it expires. The list is pruned as it is written, so it stays the size of the
// sessions that are still within their own lifetime.

export async function revokeSession(sid: string, expiresAt: number): Promise<void> {
  await transaction(database => {
    const stamp = Date.now();
    database.revoked = database.revoked.filter(entry => entry.expiresAt > stamp);
    if (!database.revoked.some(entry => entry.sid === sid)) database.revoked.push({ sid, expiresAt });
  });
}

export async function isRevoked(sid: string): Promise<boolean> {
  const database = await readDatabase();
  return database.revoked.some(entry => entry.sid === sid && entry.expiresAt > Date.now());
}

// ---- notifications ---------------------------------------------------------------------------------
// Raised inside the same transaction as the change that caused them, so a notification cannot exist for an
// event that failed to commit — and cannot be missed for one that did.
//
// Recipients are resolved from the record, never from whoever happens to be looking. A submission goes to
// the people who could actually authorise it; an outcome goes to the person who asked and to the colleague
// they copied in.

const notification = (
  database: Database,
  entry: Omit<StoredNotification, "id" | "at" | "read">,
): void => {
  database.notifications.push({ ...entry, id: randomUUID(), at: now(), read: false });
  // Keep the tail bounded; nobody reads a year-old bell item and the file should not grow without limit.
  if (database.notifications.length > 2000) database.notifications = database.notifications.slice(-2000);
};

/** Everyone whose position could sign off this amount — the people the request is actually waiting on. */
const approversFor = (database: Database, amount: number) =>
  database.users.filter(user => canApprove(user.role, amount));

export async function listNotifications(actor: Actor): Promise<StoredNotification[]> {
  const database = await readDatabase();
  const address = actor.email.toLowerCase();
  return database.notifications
    .filter(entry => entry.userId === actor.userId || (entry.email || "").toLowerCase() === address)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50);
}

export async function markNotificationsRead(actor: Actor): Promise<void> {
  await transaction(database => {
    const address = actor.email.toLowerCase();
    database.notifications = database.notifications.map(entry =>
      entry.userId === actor.userId || (entry.email || "").toLowerCase() === address
        ? { ...entry, read: true }
        : entry,
    );
  });
}

// ---- requests --------------------------------------------------------------------------------------

export async function listRequests(actor: Actor): Promise<StoredRequest[]> {
  const database = await readDatabase();
  return database.requests
    .filter(request => visibleTo(actor, request))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getRequest(actor: Actor, id: string): Promise<StoredRequest> {
  const database = await readDatabase();
  return locate(database, actor, id);
}

export async function createDraft(actor: Actor, input: DraftInput): Promise<StoredRequest> {
  // Creating a PRF is the requester's job. An approver who also needs to purchase something signs in with
  // their own requester account rather than being both author and authoriser on one record.
  if (actor.role !== "REQUESTER") throw new ForbiddenError("Only requesters can create purchase requests");
  return transaction(database => {
    const id = nextPrfNumber(database.requests);
    const stamp = now();
    const request: StoredRequest = {
      id,
      ownerId: actor.userId,
      requester: actor.name,
      cycle: "FY2027 Cycle 01",
      status: "Draft",
      amount: total(input.lineItems),
      approvals: [],
      audit: [auditEntry(actor, "Draft created")],
      createdAt: stamp,
      updatedAt: stamp,
      requesterSigned: false,
      approverSigned: false,
      documents: [],
      attachments: [],
      ...shape(input),
    };
    database.requests.push(request);
    return request;
  });
}

export async function updateDraft(actor: Actor, id: string, input: DraftInput): Promise<StoredRequest> {
  return transaction(database => {
    const request = locate(database, actor, id);
    if (request.ownerId !== actor.userId) throw new ForbiddenError("Only the requester can edit this PRF");
    if (!EDITABLE.includes(request.status)) {
      throw new ConflictError(`A ${request.status} request can no longer be edited`);
    }
    Object.assign(request, shape(input), { amount: total(input.lineItems), updatedAt: now() });
    request.audit.push(auditEntry(actor, "Draft saved"));
    return request;
  });
}

export async function deleteDraft(actor: Actor, id: string): Promise<void> {
  await transaction(database => {
    const request = locate(database, actor, id);
    if (request.ownerId !== actor.userId) throw new ForbiddenError("Only the requester can delete this PRF");
    // "Unsubmitted" is the rule. A Returned PRF has already been submitted once and its history has to
    // survive, so it can be edited and resubmitted but never deleted.
    if (request.status !== "Draft") {
      throw new ConflictError("Only an unsubmitted draft can be deleted");
    }
    database.requests = database.requests.filter(entry => entry.id !== id);
  });
}

export async function submitRequest(actor: Actor, id: string, signature: string): Promise<StoredRequest> {
  return transaction(database => {
    const request = locate(database, actor, id);
    if (request.ownerId !== actor.userId) throw new ForbiddenError("Only the requester can submit this PRF");
    assertTransition(request.status, "Awaiting Approval");
    // Submission is where a draft becomes a financial document, so the fields an approver reads to make a
    // decision stop being optional here. A draft is allowed to be incomplete; a submitted PRF is not.
    if (!signature) throw new FieldError("Signature", "An electronic signature is required to submit");
    if (!request.vendor) throw new FieldError("Vendor", "A vendor is required before submitting");
    if (!request.description) throw new FieldError("Description", "A purchase description is required before submitting");
    if (!request.school) throw new FieldError("Site", "A site or department is required before submitting");
    if (!request.fundingCode) throw new FieldError("Funding source", "A funding source is required before submitting");
    if (!request.lineItems.length) throw new FieldError("Line items", "Add at least one line item before submitting");

    const stamp = now();
    request.status = "Awaiting Approval";
    request.submittedAt = stamp;
    request.updatedAt = stamp;
    request.requesterSigned = true;
    request.requesterSignature = signature;
    request.approvals = [
      { role: "Requester", name: actor.name, status: "Signed", time: stamp },
      { role: routeFor(request.amount), name: "Unassigned", status: "Pending" },
    ];
    request.audit.push(auditEntry(actor, "Submitted and electronically signed", `Signed as "${signature}"`));
    request.audit.push({
      ...auditEntry(actor, "Routed for approval", `${routeFor(request.amount)} authority required`),
      actorId: "system",
      actorName: "System",
    });

    for (const approver of approversFor(database, request.amount)) {
      notification(database, {
        kind: "submitted",
        requestId: request.id,
        userId: approver.id,
        title: `${request.id} needs your review`,
        body: `${actor.name} submitted ${moneyText(request.amount)} for ${request.school || request.district}. Routes to ${routeFor(request.amount)}.`,
      });
    }
    return request;
  });
}

export async function decideRequest(actor: Actor, id: string, decision: Decision): Promise<StoredRequest> {
  if (!isApprover(actor.role)) throw new ForbiddenError("Only approvers can review purchase requests");
  return transaction(database => {
    const request = locate(database, actor, id);
    if (request.ownerId === actor.userId) {
      throw new ForbiddenError("You cannot approve a request you submitted");
    }
    const target: Status = decision.action === "approve" ? "Approved" : "Returned";
    assertTransition(request.status, target);
    // Authority is checked against the amount, not merely against being an approver: a Manager cannot sign
    // off a $50,000 request just because the queue showed it to them. Sending back is open to any approver —
    // spotting a problem does not require the authority to have approved it.
    if (decision.action === "approve" && !canApprove(actor.role, request.amount)) {
      throw new ForbiddenError(
        `${ROLE_LABEL[actor.role]} authority covers up to ${approvalLimit(actor.role) === Number.POSITIVE_INFINITY ? "any amount" : `$${approvalLimit(actor.role).toLocaleString()}`}. This request needs ${routeFor(request.amount)} approval.`,
      );
    }
    if (decision.action === "approve" && !request.requesterSigned) {
      throw new ConflictError("This PRF has no requester signature and cannot be approved");
    }
    // Mandatory feedback on a send-back. A PRF bounced without a reason leaves the requester guessing.
    if (decision.action === "reject" && !decision.comment) {
      throw new FieldError("Comment", "A comment is required when sending a request back");
    }
    if (decision.action === "approve" && !decision.signature) {
      throw new FieldError("Signature", "An electronic signature is required to approve");
    }

    const stamp = now();
    request.status = target;
    request.updatedAt = stamp;
    if (decision.action === "approve") {
      request.approvedAt = stamp;
      request.approverSigned = true;
      request.approverSignature = decision.signature;
    } else {
      request.reviewNote = decision.comment;
    }
    request.approvals = request.approvals.map((approval, index) =>
      index === request.approvals.length - 1
        ? { ...approval, name: actor.name, status: decision.action === "approve" ? "Signed" : "Returned", time: stamp }
        : approval,
    );
    request.audit.push(
      auditEntry(
        actor,
        decision.action === "approve" ? "Approved and electronically signed" : "Returned for changes",
        decision.comment || undefined,
      ),
    );

    const approved = decision.action === "approve";
    const title = approved ? `${request.id} was approved` : `${request.id} needs changes`;
    const body = approved
      ? `${actor.name} approved and signed ${moneyText(request.amount)} for ${request.school || request.district}.`
      : `${actor.name} sent it back: ${decision.comment}`;
    notification(database, { kind: approved ? "approved" : "returned", requestId: request.id, userId: request.ownerId, title, body });
    // The copied-in colleague hears the outcome too. They may have no account, so this one is addressed
    // to the email itself and is picked up whenever that address signs in.
    if (request.copyEmail) {
      notification(database, {
        kind: approved ? "approved" : "returned",
        requestId: request.id,
        email: request.copyEmail,
        title,
        body: `${body} You were copied in by ${request.requester}.`,
      });
    }
    return request;
  });
}

// ---- attachments -----------------------------------------------------------------------------------

/** Attaching is an edit: same owner, same statuses that allow any other change to the record. */
export async function attachToRequest(actor: Actor, id: string, attachment: StoredAttachment): Promise<StoredRequest> {
  return transaction(database => {
    const request = locate(database, actor, id);
    if (request.ownerId !== actor.userId) throw new ForbiddenError("Only the requester can attach files to this PRF");
    if (!EDITABLE.includes(request.status)) {
      throw new ConflictError(`Files cannot be added to a ${request.status} request`);
    }
    if (request.attachments.length >= 20) throw new ConflictError("A request can hold at most 20 attachments");
    request.attachments.push(attachment);
    request.updatedAt = now();
    request.audit.push(auditEntry(actor, "Attached a document", attachment.name));
    return request;
  });
}

export async function detachFromRequest(actor: Actor, id: string, attachmentId: string): Promise<StoredAttachment> {
  return transaction(database => {
    const request = locate(database, actor, id);
    if (request.ownerId !== actor.userId) throw new ForbiddenError("Only the requester can remove files from this PRF");
    if (!EDITABLE.includes(request.status)) {
      throw new ConflictError(`Files cannot be removed from a ${request.status} request`);
    }
    const attachment = request.attachments.find(entry => entry.id === attachmentId);
    if (!attachment) throw new NotFoundError("That file could not be found");
    request.attachments = request.attachments.filter(entry => entry.id !== attachmentId);
    request.updatedAt = now();
    request.audit.push(auditEntry(actor, "Removed a document", attachment.name));
    return attachment;
  });
}

/**
 * Resolves a file for download.
 *
 * Reading goes through locate(), so the same rule that decides who can see a PRF decides who can open its
 * receipts: the requester who wrote it, anyone with signing authority, and Finance or an administrator.
 * Everyone else gets Not Found, including for a file whose id they somehow know.
 */
export async function getAttachment(actor: Actor, id: string, attachmentId: string): Promise<StoredAttachment> {
  const database = await readDatabase();
  const request = locate(database, actor, id);
  const attachment = request.attachments.find(entry => entry.id === attachmentId);
  if (!attachment) throw new NotFoundError("That file could not be found");
  return attachment;
}

// ---- profiles and role assignment --------------------------------------------------------------------

export type ProfileInput = { firstName: string; lastName: string; contactEmail: string };

/** Anyone may edit their own name and contact address. Nobody may edit their own position this way. */
export async function updateProfile(actor: Actor, input: ProfileInput): Promise<StoredUser> {
  return transaction(database => {
    const user = database.users.find(entry => entry.id === actor.userId);
    if (!user) throw new NotFoundError("That account could not be found");
    user.firstName = input.firstName;
    user.lastName = input.lastName;
    user.name = `${input.firstName} ${input.lastName}`.trim() || user.email;
    user.contactEmail = input.contactEmail || user.email;
    return user;
  });
}

/**
 * Reassigns someone's position.
 *
 * Restricted to Finance and administrators, and refused for the caller's own account. Self-assignment is
 * how a role system quietly stops meaning anything: the check above would otherwise let an administrator
 * grant themselves CEO signing authority without anyone else being involved.
 */
export async function assignRole(actor: Actor, userId: string, role: Role): Promise<StoredUser> {
  if (!isAdmin(actor.role)) throw new ForbiddenError("Only Finance and administrators can change positions");
  if (userId === actor.userId) throw new ForbiddenError("You cannot change your own position");
  return transaction(database => {
    const user = database.users.find(entry => entry.id === userId);
    if (!user) throw new NotFoundError("That account could not be found");
    user.role = role;
    return user;
  });
}

// ---- internals -------------------------------------------------------------------------------------

const total = (lines: StoredLine[]) =>
  Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;

/**
 * The fields a client is allowed to set, listed explicitly.
 *
 * Assigning a whole request body would let a caller set status, ownerId, audit or approverSigned by adding
 * them to the JSON. Everything not named here is owned by the server.
 */
function shape(input: DraftInput) {
  return {
    vendor: input.vendor,
    copyName: input.copyName,
    copyEmail: input.copyEmail,
    vendorAddress: input.vendorAddress,
    vendorCity: input.vendorCity,
    vendorEmail: input.vendorEmail,
    description: input.description,
    justification: input.justification,
    district: input.district,
    school: input.school,
    siteCode: input.siteCode,
    fundingCode: input.fundingCode,
    paymentType: input.paymentType,
    expenseType: input.expenseType,
    customSite: input.customSite,
    customFunding: input.customFunding,
    lineItems: input.lineItems,
    ...(input.documents ? { documents: input.documents } : {}),
  };
}

// The approval ladder, mirrored from the design system's APPROVAL_TIERS. The server cannot import the
// client bundle, and routing decided in the browser is not a routing decision at all — so the thresholds
// live in both places and design-system/test/authz.mjs asserts the two lists stay identical.
export const APPROVAL_LADDER: { max: number; role: string }[] = [
  { max: 5000, role: "Manager" },
  { max: 15000, role: "Director" },
  { max: 25000, role: "Senior Director" },
  { max: 75000, role: "Chief" },
  { max: 250000, role: "CFO + CEO" },
  { max: Number.POSITIVE_INFINITY, role: "CEO" },
];

export function routeFor(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return APPROVAL_LADDER[0].role;
  return (APPROVAL_LADDER.find(tier => amount <= tier.max) || APPROVAL_LADDER[APPROVAL_LADDER.length - 1]).role;
}
