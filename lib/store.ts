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

export type Role = "REQUESTER" | "APPROVER";
export type Status = "Draft" | "Awaiting Approval" | "Returned" | "Approved";

/** Whoever is performing the operation. Structurally satisfied by a Session, so no import cycle. */
export type Actor = { userId: string; email: string; name: string; role: Role };

export type StoredUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  district: string;
  school: string;
  passwordHash: string;
};

export type StoredLine = { description: string; quantity: number; unitPrice: number };
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
  lineItems: StoredLine[];
  documents: string[];
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

const EMPTY: Database = { version: 1, users: [], requests: [], revoked: [] };

let cache: Database | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function readDatabase(): Promise<Database> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    cache = {
      version: parsed.version || 1,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
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

/** A requester sees only their own requests; an approver sees the whole register. */
const visibleTo = (actor: Actor, request: StoredRequest) =>
  actor.role === "APPROVER" || request.ownerId === actor.userId;

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
  description: string;
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
    return request;
  });
}

export async function decideRequest(actor: Actor, id: string, decision: Decision): Promise<StoredRequest> {
  if (actor.role !== "APPROVER") throw new ForbiddenError("Only approvers can review purchase requests");
  return transaction(database => {
    const request = locate(database, actor, id);
    if (request.ownerId === actor.userId) {
      throw new ForbiddenError("You cannot approve a request you submitted");
    }
    const target: Status = decision.action === "approve" ? "Approved" : "Returned";
    assertTransition(request.status, target);
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
    return request;
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
    description: input.description,
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
