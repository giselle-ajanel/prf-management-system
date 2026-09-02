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
/**
 * What someone may do in the Hub. Five roles, by responsibility rather than job title.
 *
 * Signing authority is a separate axis: an Approver also carries a `tier`, which is the dollar band they
 * may authorise. Keeping them apart is what lets a Director's authority change without touching what kind
 * of user they are, and what lets Finance hold review powers with no signing authority at all.
 */
export type Role = "REQUESTER" | "APPROVER" | "FINANCE_REVIEWER" | "FINANCE_ADMIN" | "VIEW_ONLY";

export const ROLES: Role[] = ["REQUESTER", "APPROVER", "FINANCE_REVIEWER", "FINANCE_ADMIN", "VIEW_ONLY"];

export const ROLE_LABEL: Record<Role, string> = {
  REQUESTER: "Requester",
  APPROVER: "Approver",
  FINANCE_REVIEWER: "Finance Reviewer",
  FINANCE_ADMIN: "Finance Administrator",
  VIEW_ONLY: "View Only",
};

/**
 * Which kind of viewer a View Only account is.
 *
 * The five come from how people actually use the spend platform: an auditor pulling records for an
 * external review, a bookkeeper reconciling, a staff member watching their own budget line, a travel
 * manager tracking trip spending, an assistant looking things up for someone else. They differ in one
 * respect that matters — an auditor can take the register away with them — and in nothing else.
 */
export type ViewerProfile = "AUDITOR" | "BOOKKEEPER" | "MEMBER" | "TRAVEL_MANAGER" | "ASSISTANT";

export const VIEWER_PROFILES: ViewerProfile[] = ["AUDITOR", "BOOKKEEPER", "MEMBER", "TRAVEL_MANAGER", "ASSISTANT"];

export const VIEWER_LABEL: Record<ViewerProfile, string> = {
  AUDITOR: "Auditor",
  BOOKKEEPER: "Bookkeeper",
  MEMBER: "Member",
  TRAVEL_MANAGER: "Travel Manager",
  ASSISTANT: "Assistant",
};

/** The signing ladder. Only meaningful for an Approver; everyone else carries no tier. */
export type Tier = "MANAGER" | "DIRECTOR" | "SENIOR_DIRECTOR" | "CHIEF" | "CFO" | "CEO";

export const TIERS: Tier[] = ["MANAGER", "DIRECTOR", "SENIOR_DIRECTOR", "CHIEF", "CFO", "CEO"];

export const TIER_LABEL: Record<Tier, string> = {
  MANAGER: "Manager",
  DIRECTOR: "Director",
  SENIOR_DIRECTOR: "Senior Director",
  CHIEF: "Chief",
  CFO: "CFO",
  CEO: "CEO",
};

const TIER_LIMIT: Record<Tier, number> = {
  MANAGER: 5000,
  DIRECTOR: 15000,
  SENIOR_DIRECTOR: 25000,
  CHIEF: 75000,
  CFO: Number.POSITIVE_INFINITY,
  CEO: Number.POSITIVE_INFINITY,
};

export const tierLimit = (tier: Tier | undefined) => (tier ? TIER_LIMIT[tier] : 0);

/** The lowest tier that may authorise this amount. */
export function tierForAmount(amount: number): Tier {
  if (!Number.isFinite(amount) || amount <= 0) return "MANAGER";
  return TIERS.find(tier => amount <= TIER_LIMIT[tier]) || "CEO";
}

/**
 * The tier immediately above this one.
 *
 * Used when an Approver submits their own request: it escalates past them, so nobody is ever both the
 * author and a candidate signer on the same record. CEO is the top, so a CEO's own request stays there and
 * is caught instead by the rule that an approver cannot approve what they submitted.
 */
export const nextTierAbove = (tier: Tier): Tier => TIERS[Math.min(TIERS.indexOf(tier) + 1, TIERS.length - 1)];

// ---- capabilities ----------------------------------------------------------------------------------
// Cumulative by design: an Approver and a Finance Reviewer are both requesters who can do more.

/** Everyone except a read-only viewer may write their own requests. */
export const canRequest = (role: Role) => role !== "VIEW_ONLY";
export const isApprover = (role: Role) => role === "APPROVER";
export const isFinance = (role: Role) => role === "FINANCE_REVIEWER" || role === "FINANCE_ADMIN";
export const isAdmin = (role: Role) => role === "FINANCE_ADMIN";
/** Read the whole organisation's submitted requests rather than only one's own. */
export const seesRegister = (role: Role) => role !== "REQUESTER";

/**
 * Who may take the register away as a file.
 *
 * Everyone who works the requests can export. Among read-only accounts only the auditor can: exporting is
 * how an external audit happens, and it is also how a whole organisation's spending leaves the building,
 * so the other four viewer profiles read on screen and nothing more.
 */
export const canExport = (role: Role, viewer?: ViewerProfile) =>
  role === "VIEW_ONLY" ? viewer === "AUDITOR" : seesRegister(role);

/**
 * The single gate on changing a purchase request.
 *
 * Called first by every mutating operation in this module, so a read-only account is refused with 403
 * before any question of ownership or status is even asked. Hiding the buttons is a courtesy; this is the
 * rule.
 */
function assertCanMutateRequests(actor: Actor): void {
  if (actor.role === "VIEW_ONLY") {
    throw new ForbiddenError("This is a view-only account and cannot change purchase requests");
  }
}

// ---- reading forward from the previous model ---------------------------------------------------------
// The ladder used to be the role itself, and there was one approval gate rather than two. Stores written
// then are translated on read so an existing deployment keeps working.

const LEGACY_ROLE_TO_TIER: Record<string, Tier> = {
  MANAGER: "MANAGER", DIRECTOR: "DIRECTOR", SENIOR_DIRECTOR: "SENIOR_DIRECTOR",
  CHIEF: "CHIEF", CFO: "CFO", CEO: "CEO", APPROVER: "DIRECTOR",
};

export function normalizeRole(value: unknown): { role: Role; tier?: Tier } {
  const raw = String(value || "");
  if ((ROLES as string[]).includes(raw)) return { role: raw as Role };
  if (LEGACY_ROLE_TO_TIER[raw]) return { role: "APPROVER", tier: LEGACY_ROLE_TO_TIER[raw] };
  if (raw === "FINANCE") return { role: "FINANCE_ADMIN" };
  if (raw === "ADMIN") return { role: "FINANCE_ADMIN" };
  return { role: "REQUESTER" };
}

const LEGACY_STATUS: Record<string, Status> = {
  "Awaiting Approval": "Pending Supervisor Approval",
  Returned: "Needs Revision",
};

export const normalizeStatus = (value: unknown): Status => {
  const raw = String(value || "");
  return LEGACY_STATUS[raw] || ((["Draft", "Pending Supervisor Approval", "Pending Finance Review", "Needs Revision", "Approved"] as string[]).includes(raw) ? (raw as Status) : "Draft");
};

/**
 * The lifecycle, as two gates rather than one.
 *
 * Gate 1 is the supervisor's signature; gate 2 is Finance's compliance review. A request only reaches
 * Finance because an approver put it there, which is the whole point of the sequence: Finance checks the
 * coding and the receipts on something that already has authority behind it, not on a proposal.
 */
export type Status =
  | "Draft"
  | "Pending Supervisor Approval"
  | "Pending Finance Review"
  | "Needs Revision"
  | "Approved";

/** Whoever is performing the operation. Structurally satisfied by a Session, so no import cycle. */
export type Actor = { userId: string; email: string; name: string; role: Role; tier?: Tier; viewer?: ViewerProfile };

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
  /** Signing band. Only meaningful for an Approver; ignored for every other role. */
  tier?: Tier;
  /** Which kind of viewer. Only meaningful for a View Only account. */
  viewer?: ViewerProfile;
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
  /** Display name and immutable id of whoever approved, so the record survives a later rename. */
  approverName?: string;
  approverId?: string;
  /** Gate 2: who cleared it for payment, and when the record became final. */
  financeSigned?: boolean;
  financeName?: string;
  financeId?: string;
  completedAt?: string;
  /** The tier this request must reach, fixed at submission — including any escalation. */
  requiredTier?: Tier;
  reviewNote?: string;
  /** Who sent it back. An approver tracks their own returns through to resolution. */
  returnedBy?: string;
  returnedByName?: string;
  /** Which gate sent it back, so the requester knows whether it is an authority or a fiscal problem. */
  returnedStage?: "supervisor" | "finance";
};

/** One entry in the account log: a profile rename or a position change, always keyed to the user id. */
export type AccountEvent = {
  id: string;
  at: string;
  /** Who performed it. For a rename this is the account itself; for a position change, the administrator. */
  actorId: string;
  actorName: string;
  /** The account the change was made to. */
  subjectId: string;
  action: string;
  detail: string;
};

type Database = {
  version: number;
  users: StoredUser[];
  requests: StoredRequest[];
  notifications: StoredNotification[];
  accountLog: AccountEvent[];
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

const EMPTY: Database = { version: 1, users: [], requests: [], notifications: [], accountLog: [], revoked: [] };

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
        const resolved = normalizeRole(user.role);
        return {
          ...user,
          role: resolved.role,
          // "APPROVER" was also the old single approver role, which carried no tier of its own. An
          // approver without a band would have an authority limit of zero, so one is defaulted here.
          tier: user.tier || resolved.tier || (resolved.role === "APPROVER" ? "DIRECTOR" : undefined),
          firstName: user.firstName || names.firstName,
          lastName: user.lastName || names.lastName,
          contactEmail: user.contactEmail || user.email,
        };
      }),
      requests: (Array.isArray(parsed.requests) ? parsed.requests : []).map(request => ({
        ...request,
        status: normalizeStatus(request.status),
        // Records written before attachments existed have no array; readers should never have to guard.
        attachments: Array.isArray(request.attachments) ? request.attachments : [],
      })),
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      accountLog: Array.isArray(parsed.accountLog) ? parsed.accountLog : [],
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
    assertLogAppendOnly(database.accountLog, draft.accountLog);
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
/** The account log grows and is never rewritten, exactly like a request's own trail. */
function assertLogAppendOnly(before: AccountEvent[], after: AccountEvent[]): void {
  const kept = after.slice(0, before.length);
  const same =
    kept.length === before.length &&
    kept.every((entry, index) => entry.id === before[index].id && entry.at === before[index].at && entry.action === before[index].action);
  if (!same) throw new Error("the account log was modified rather than appended to");
}

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
  Draft: ["Pending Supervisor Approval"],
  "Needs Revision": ["Pending Supervisor Approval"],
  "Pending Supervisor Approval": ["Pending Finance Review", "Needs Revision"],
  "Pending Finance Review": ["Approved", "Needs Revision"],
  Approved: [],
};

export function assertTransition(from: Status, to: Status): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConflictError(`A request that is ${from} cannot become ${to}`);
  }
}

/** Statuses whose content the owner may still change. A returned PRF is editable so it can be fixed. */
const EDITABLE: Status[] = ["Draft", "Needs Revision"];

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

/**
 * Who may see a request.
 *
 * A draft is the author's private working copy — an unfinished thought about money, with half-typed
 * vendors and placeholder amounts. Nobody else sees it, in any role, ever. That is the one rule here with
 * no exceptions.
 *
 * Past that, each role sees the stage it is responsible for. An approver sees what is waiting at gate 1,
 * plus the requests they personally signed or returned, so their own decisions stay trackable. A Finance
 * Reviewer sees gate 2 and what has completed — never a request still waiting on a supervisor, because
 * reviewing coding on something that might yet be rejected is wasted work and the sequence exists to
 * prevent it. Administrators and read-only viewers see every submitted request, the first because they
 * answer for the register and the second because that is the whole point of the role.
 */
const visibleTo = (actor: Actor, request: StoredRequest) => {
  if (request.ownerId === actor.userId) return true;
  if (request.status === "Draft") return false;
  if (isAdmin(actor.role) || actor.role === "VIEW_ONLY") return true;

  if (actor.role === "FINANCE_REVIEWER") {
    if (request.status === "Pending Finance Review" || request.status === "Approved") return true;
    // A request they themselves returned stays with them until it comes back round.
    return request.status === "Needs Revision" && request.returnedBy === actor.userId;
  }

  if (isApprover(actor.role)) {
    if (request.status === "Pending Supervisor Approval") return true;
    if (request.status === "Needs Revision") return request.returnedBy === actor.userId;
    // Once signed, it belongs to Finance — but the approver who signed it can still follow it.
    return request.approverId === actor.userId;
  }

  return false;
};

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

const accountEvent = (
  database: Database,
  actor: Actor,
  subjectId: string,
  action: string,
  detail: string,
): void => {
  database.accountLog.push({
    id: randomUUID(), at: now(), actorId: actor.userId, actorName: actor.name, subjectId, action, detail,
  });
};

const notification = (
  database: Database,
  entry: Omit<StoredNotification, "id" | "at" | "read">,
): void => {
  database.notifications.push({ ...entry, id: randomUUID(), at: now(), read: false });
  // Keep the tail bounded; nobody reads a year-old bell item and the file should not grow without limit.
  if (database.notifications.length > 2000) database.notifications = database.notifications.slice(-2000);
};

/** The approvers a request is actually waiting on: enough authority, and not its author. */
const approversFor = (database: Database, request: StoredRequest) =>
  database.users.filter(
    user =>
      isApprover(user.role) &&
      user.id !== request.ownerId &&
      tierLimit(user.tier) >= tierLimit(request.requiredTier || tierForAmount(request.amount)),
  );

/** The account log. Administrators only — it names who changed whose position, and when. */
export async function listAccountLog(actor: Actor): Promise<AccountEvent[]> {
  if (!isAdmin(actor.role)) throw new ForbiddenError("Only Finance and administrators can read the account log");
  const database = await readDatabase();
  // Reversed rather than sorted by timestamp: the log is append-only, so insertion order IS chronological,
  // and two events in the same millisecond would otherwise come back in an arbitrary order.
  return [...database.accountLog].reverse().slice(0, 200);
}

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
  // Everyone who works here buys things, so every role except a read-only viewer can raise a request. An
  // approver's own request is escalated past them at submission, and they still cannot approve it.
  assertCanMutateRequests(actor);
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
  assertCanMutateRequests(actor);
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
  assertCanMutateRequests(actor);
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
  assertCanMutateRequests(actor);
  return transaction(database => {
    const request = locate(database, actor, id);
    if (request.ownerId !== actor.userId) throw new ForbiddenError("Only the requester can submit this PRF");
    assertTransition(request.status, "Pending Supervisor Approval");
    // Submission is where a draft becomes a financial document, so the fields an approver reads to make a
    // decision stop being optional here. A draft is allowed to be incomplete; a submitted PRF is not.
    if (!signature) throw new FieldError("Signature", "An electronic signature is required to submit");
    if (!request.vendor) throw new FieldError("Vendor", "A vendor is required before submitting");
    if (!request.description) throw new FieldError("Description", "A purchase description is required before submitting");
    if (!request.school) throw new FieldError("Site", "A site or department is required before submitting");
    if (!request.fundingCode) throw new FieldError("Funding source", "A funding source is required before submitting");
    if (!request.lineItems.length) throw new FieldError("Line items", "Add at least one line item before submitting");

    const stamp = now();
    request.status = "Pending Supervisor Approval";
    request.submittedAt = stamp;
    request.updatedAt = stamp;
    request.requesterSigned = true;
    request.requesterSignature = signature;
    // An approver's own request escalates past their own tier, so they are never a candidate signer on it.
    // The rule that they cannot approve their own submission still holds; this stops the request from
    // sitting in their queue looking actionable in the first place.
    const byAmount = tierForAmount(request.amount);
    const required =
      isApprover(actor.role) && actor.tier && tierLimit(actor.tier) >= tierLimit(byAmount)
        ? nextTierAbove(actor.tier)
        : byAmount;
    request.requiredTier = required;
    request.approvals = [
      { role: "Requester", name: actor.name, status: "Signed", time: stamp },
      { role: TIER_LABEL[required], name: "Unassigned", status: "Pending" },
    ];
    request.audit.push(auditEntry(actor, "Submitted and electronically signed", `Signed as "${signature}"`));
    request.audit.push({
      ...auditEntry(actor, "Routed for approval", `${TIER_LABEL[required]} authority required`),
      actorId: "system",
      actorName: "System",
    });

    for (const approver of approversFor(database, request)) {
      notification(database, {
        kind: "submitted",
        requestId: request.id,
        userId: approver.id,
        title: `${request.id} needs your review`,
        body: `${actor.name} submitted ${moneyText(request.amount)} for ${request.school || request.district}. Routes to ${TIER_LABEL[required]}.`,
      });
    }
    return request;
  });
}

/**
 * Gate 1 — the supervisor's decision.
 *
 * Approving does not finish a request; it hands it to Finance. That is the sequence the whole refactor
 * exists for: Finance reviews coding, receipts and policy on something that already carries authority,
 * rather than on a proposal that might still be sent back.
 */
export async function decideRequest(actor: Actor, id: string, decision: Decision): Promise<StoredRequest> {
  assertCanMutateRequests(actor);
  if (!isApprover(actor.role)) throw new ForbiddenError("Only approvers can sign off purchase requests");
  return transaction(database => {
    const request = locate(database, actor, id);
    // Finance's gate is a different endpoint; an approver acting on a request already past them would be
    // signing something twice.
    if (request.status === "Pending Finance Review") {
      throw new ForbiddenError("This request has already been approved and is with Finance");
    }
    if (request.ownerId === actor.userId) {
      throw new ForbiddenError("You cannot approve a request you submitted");
    }
    const target: Status = decision.action === "approve" ? "Pending Finance Review" : "Needs Revision";
    assertTransition(request.status, target);

    if (decision.action === "approve") {
      // Authority is checked against the amount, not merely against being an approver: a Manager cannot
      // sign off a $50,000 request just because the queue showed it to them.
      if (!request.requesterSigned) {
        throw new ConflictError("This PRF has no requester signature and cannot be approved");
      }
      if (!decision.signature) throw new FieldError("Signature", "An electronic signature is required to approve");
      const needed = request.requiredTier || tierForAmount(request.amount);
      if (tierLimit(actor.tier) < tierLimit(needed)) {
        const held = tierLimit(actor.tier);
        throw new ForbiddenError(
          `${actor.tier ? TIER_LABEL[actor.tier] : "This"} authority covers up to ${held === Number.POSITIVE_INFINITY ? "any amount" : `$${held.toLocaleString()}`}. This request needs ${TIER_LABEL[needed]} approval.`,
        );
      }
    }
    // Mandatory feedback on a send-back. A PRF bounced without a reason leaves the requester guessing.
    if (decision.action === "reject" && !decision.comment) {
      throw new FieldError("Comment", "A comment is required when sending a request back");
    }

    const stamp = now();
    request.status = target;
    request.updatedAt = stamp;

    if (decision.action === "approve") {
      request.approverSigned = true;
      request.approverSignature = decision.signature;
      // Both, deliberately: the name is what a reader of the PRF needs, and the id is what survives the
      // approver later changing their name. An audit that kept only the name would go ambiguous.
      request.approverName = actor.name;
      request.approverId = actor.userId;
      request.approvedAt = stamp;
      request.approvals = [
        ...request.approvals.map((approval, index) =>
          index === request.approvals.length - 1
            ? { ...approval, name: actor.name, status: "Signed", time: stamp }
            : approval,
        ),
        { role: "Finance", name: "Unassigned", status: "Pending" },
      ];
      request.audit.push(auditEntry(actor, "Approved and electronically signed", `Gate 1 cleared by ${TIER_LABEL[actor.tier || "MANAGER"]}`));
      request.audit.push({
        ...auditEntry(actor, "Sent to Finance review", "Gate 2: coding, receipts and policy"),
        actorId: "system",
        actorName: "System",
      });

      for (const reviewer of database.users.filter(user => isFinance(user.role))) {
        notification(database, {
          kind: "submitted",
          requestId: request.id,
          userId: reviewer.id,
          title: `${request.id} is ready for Finance review`,
          body: `${actor.name} approved ${moneyText(request.amount)} for ${request.school || request.district}. Check coding, receipts and policy.`,
        });
      }
      notification(database, {
        kind: "approved",
        requestId: request.id,
        userId: request.ownerId,
        title: `${request.id} cleared supervisor approval`,
        body: `${actor.name} signed it. It is now with Finance for the final review.`,
      });
    } else {
      returnToRequester(database, request, actor, decision.comment, "supervisor");
    }
    return request;
  });
}

/**
 * Gate 2 — Finance's compliance review.
 *
 * Reachable only from "Pending Finance Review", which only an approver's signature produces. A Finance
 * Reviewer who tries to act on a request still sitting at gate 1 is refused: the locked stage is the
 * mechanism, not a hidden button.
 */
export async function financeReview(actor: Actor, id: string, decision: Decision): Promise<StoredRequest> {
  assertCanMutateRequests(actor);
  if (!isFinance(actor.role)) throw new ForbiddenError("Only Finance can complete the compliance review");
  return transaction(database => {
    const request = locate(database, actor, id);
    if (request.status === "Pending Supervisor Approval") {
      throw new ForbiddenError("This request is still awaiting supervisor approval and is not open to Finance yet");
    }
    const target: Status = decision.action === "approve" ? "Approved" : "Needs Revision";
    assertTransition(request.status, target);

    if (decision.action === "approve" && !decision.signature) {
      throw new FieldError("Signature", "An electronic signature is required to clear a request for payment");
    }
    if (decision.action === "reject" && !decision.comment) {
      throw new FieldError("Comment", "A compliance note is required when returning a request");
    }

    const stamp = now();
    request.status = target;
    request.updatedAt = stamp;

    if (decision.action === "approve") {
      request.financeSigned = true;
      request.financeName = actor.name;
      request.financeId = actor.userId;
      request.completedAt = stamp;
      request.approvals = request.approvals.map((approval, index) =>
        index === request.approvals.length - 1
          ? { ...approval, name: actor.name, status: "Cleared for payment", time: stamp }
          : approval,
      );
      request.audit.push(auditEntry(actor, "Cleared for payment by Finance", decision.comment || "Gate 2 cleared"));

      const title = `${request.id} is approved and complete`;
      const body = `${actor.name} cleared ${moneyText(request.amount)} for payment. The record is now final.`;
      notification(database, { kind: "approved", requestId: request.id, userId: request.ownerId, title, body });
      if (request.copyEmail) {
        notification(database, {
          kind: "approved", requestId: request.id, email: request.copyEmail, title,
          body: `${body} You were copied in by ${request.requester}.`,
        });
      }
    } else {
      returnToRequester(database, request, actor, decision.comment, "finance");
    }
    return request;
  });
}

/**
 * Sending a request back, from either gate.
 *
 * The stage it came from is recorded on the entry, because "Finance returned this over the funding code"
 * and "your manager returned this over the justification" send the requester to different parts of the
 * form.
 */
function returnToRequester(
  database: Database,
  request: StoredRequest,
  actor: Actor,
  comment: string,
  stage: "supervisor" | "finance",
): void {
  const stamp = now();
  request.reviewNote = comment;
  request.returnedBy = actor.userId;
  request.returnedByName = actor.name;
  request.returnedStage = stage;
  request.approvals = request.approvals.map((approval, index) =>
    index === request.approvals.length - 1
      ? { ...approval, name: actor.name, status: "Returned", time: stamp }
      : approval,
  );
  request.audit.push(
    auditEntry(
      actor,
      stage === "finance" ? "Returned by Finance review" : "Returned for changes",
      stage === "finance" ? `Fiscal issue: ${comment}` : comment,
    ),
  );

  const title = `${request.id} needs changes`;
  const body =
    stage === "finance"
      ? `${actor.name} returned it from Finance review: ${comment}`
      : `${actor.name} sent it back: ${comment}`;
  notification(database, { kind: "returned", requestId: request.id, userId: request.ownerId, title, body });
  if (request.copyEmail) {
    notification(database, {
      kind: "returned", requestId: request.id, email: request.copyEmail, title,
      body: `${body} You were copied in by ${request.requester}.`,
    });
  }
}

// ---- attachments -----------------------------------------------------------------------------------

/** Attaching is an edit: same owner, same statuses that allow any other change to the record. */
export async function attachToRequest(actor: Actor, id: string, attachment: StoredAttachment): Promise<StoredRequest> {
  assertCanMutateRequests(actor);
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
  assertCanMutateRequests(actor);
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
    const before = { name: user.name, contactEmail: user.contactEmail };
    user.firstName = input.firstName;
    user.lastName = input.lastName;
    user.name = `${input.firstName} ${input.lastName}`.trim() || user.email;
    user.contactEmail = input.contactEmail || user.email;
    if (before.name !== user.name) {
      accountEvent(database, actor, user.id, "Display name changed", `"${before.name}" to "${user.name}"`);
    }
    if (before.contactEmail !== user.contactEmail) {
      accountEvent(database, actor, user.id, "Contact address changed", `"${before.contactEmail}" to "${user.contactEmail}"`);
    }
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
    const previous = user.role;
    user.role = role;
    if (previous !== role) {
      accountEvent(database, actor, user.id, "Position changed", `${ROLE_LABEL[previous]} to ${ROLE_LABEL[role]}`);
    }
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
