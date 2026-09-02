// Authorisation, session and input-handling tests for the server layer.
//
//   node test/authz.mjs
//
// These exercise lib/ directly rather than through HTTP, because the rules they cover are properties of the
// data-access layer: a requester cannot read another requester's PRF whether the call arrives from the UI,
// from curl, or from a handler someone adds next year and forgets to guard. test/http.mjs covers the wiring
// on top — cookies, CSRF, status codes — against a running server.

import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "..");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "prf-authz-"));
// The bundle is written inside the project so Node resolves the externals (react, next) from the
// repository's own node_modules; only the data store lives in the system temp directory.
const buildDir = path.join(here, ".tmp");
await fs.rm(buildDir, { recursive: true, force: true });
await fs.mkdir(buildDir, { recursive: true });

process.env.PRF_STORE_PATH = path.join(tmp, "store.json");
process.env.PRF_SESSION_SECRET = "test-secret-that-is-long-enough-to-be-accepted";
process.env.NODE_ENV = "test";

// ---- bundle the modules under test -----------------------------------------------------------------
const outfile = path.join(buildDir, "server.mjs");
await build({
  stdin: {
    contents: `
      export * from "./lib/store.ts";
      export * from "./lib/session.ts";
      export * from "./lib/password.ts";
      export * as sanitize from "./lib/sanitize.ts";
      export * as input from "./lib/prf-input.ts";
      export * as uploads from "./lib/uploads.ts";
      export { isRetiredSite } from "./lib/accounting.ts";
      export { APPROVAL_TIERS } from "./design-system/src/utils.ts";
      export { DEFAULT_PAYMENT_TYPES, DEFAULT_EXPENSE_TYPES } from "./design-system/src/components/RequestForm.tsx";
    `,
    resolveDir: root,
    loader: "ts",
  },
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "next/server", "next/headers"],
  alias: { "server-only": path.join(here, "stubs", "server-only.js") },
  logOverride: { "ignored-directive": "silent" },
  logLevel: "error",
});
const S = await import(pathToFileURL(outfile).href);

// ---- tiny runner -----------------------------------------------------------------------------------
let passed = 0;
const failures = [];
const check = async (name, work) => {
  try {
    await work();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error && error.message}`);
  }
};

/** Asserts that `work` rejects with an error whose name or message matches. */
const rejects = async (work, expected) => {
  try {
    await work();
  } catch (error) {
    const text = `${error.name}: ${error.message}`;
    assert.ok(text.includes(expected), `expected "${expected}", got "${text}"`);
    return;
  }
  assert.fail(`expected a rejection matching "${expected}"`);
};

// ---- actors ----------------------------------------------------------------------------------------
const alice = { userId: "u-alice", email: "alice@woodcraftrangers.org", name: "Alice Requester", role: "REQUESTER" };
const bob = { userId: "u-bob", email: "bob@woodcraftrangers.org", name: "Bob Requester", role: "REQUESTER" };
const approver = { userId: "u-appr", email: "director@woodcraftrangers.org", name: "Ana Rivera", role: "DIRECTOR" };
const manager = { userId: "u-mgr", email: "manager@woodcraftrangers.org", name: "Marcus Lee", role: "MANAGER" };
const finance = { userId: "u-fin", email: "finance@woodcraftrangers.org", name: "Tomas Reyes", role: "FINANCE" };

const draft = (overrides = {}) => ({
  vendor: "Northstar Learning",
  vendorAddress: "1200 Vendor Way",
  vendorCity: "Los Angeles, CA 90015",
  vendorEmail: "orders@northstar.example",
  justification: "Site code entered by hand: this partnership has no FY27 workbook row yet.",
  description: "24 robotics kits for the Grade 9 after-school STEM lab, for 24 students",
  district: "District 4",
  school: "Central High School",
  siteCode: "7704",
  fundingCode: "88STEM",
  paymentType: "direct",
  expenseType: "Program Supplies",
  customSite: false,
  customFunding: false,
  lineItems: [
    { description: "Classroom robotics kit", quantity: 24, unitPrice: 325, expenseType: "Program Supplies", club: "STEM", splitSite: "7704" },
  ],
  ...overrides,
});

// ---- input handling --------------------------------------------------------------------------------

await check("sanitize strips control characters and bidi overrides", () => {
  const dirty = `Robotics${String.fromCharCode(0)} kit${String.fromCharCode(0x202e)} order`;
  const cleaned = S.sanitize.clean(dirty);
  assert.equal(cleaned, "Robotics kit order");
  assert.ok(!Array.from(cleaned).some(character => character.charCodeAt(0) === 0x202e));
});

await check("sanitize keeps newlines in free text but flattens them in single-line fields", () => {
  const value = ["first", "second"].join(String.fromCharCode(10));
  assert.equal(S.sanitize.optionalText(value, "Note", 100), value);
  assert.equal(S.sanitize.line(value, "Vendor", 100), "first second");
});

await check("sanitize rejects out-of-range values rather than truncating", () => {
  assert.throws(() => S.sanitize.text("x".repeat(50), "Vendor", 20), /20 characters or fewer/);
  assert.throws(() => S.sanitize.money("-5", "Amount"), /cannot be negative/);
  assert.throws(() => S.sanitize.money("banana", "Amount"), /must be a number/);
  assert.throws(() => S.sanitize.count(0, "Quantity"), /at least 1/);
  assert.throws(() => S.sanitize.email("not-an-address"), /valid email/);
  assert.throws(() => S.sanitize.id("../../etc/passwd", "Request id"), /not a valid identifier/);
});

await check("script markup cannot survive in a vendor name, and plain text is untouched", () => {
  const parsed = S.input.parseDraft(draft({ vendor: "<script>alert(1)</script>Northstar" }));
  assert.equal(parsed.vendor, "scriptalert(1)/scriptNorthstar");
  assert.ok(!parsed.vendor.includes("<"));
  // Free text keeps its angle brackets: "<10 students" is a sentence, not an attack.
  assert.match(S.input.parseDraft(draft({ description: "Kits for <10 students" })).description, /<10 students/);
});

await check("parseDraft ignores fields the client is not allowed to set", () => {
  const parsed = S.input.parseDraft({
    ...draft(),
    status: "Approved",
    ownerId: "u-someone-else",
    approverSigned: true,
    audit: [{ action: "forged" }],
  });
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.ownerId, undefined);
  assert.equal(parsed.approverSigned, undefined);
  assert.equal(parsed.audit, undefined);
});

await check("parseDraft refuses a payment type outside the server's own list", () => {
  assert.throws(() => S.input.parseDraft(draft({ paymentType: "wire-transfer" })), /not a permitted value/);
});

await check("parseDraft leaves documents alone when the client does not mention them", () => {
  assert.equal(S.input.parseDraft(draft()).documents, undefined);
  assert.deepEqual(S.input.parseDraft({ ...draft(), documents: ["quote.pdf"] }).documents, ["quote.pdf"]);
});

await check("a draft round-trips every field the editor holds, not just the headline ones", async () => {
  const saved = await S.createDraft(alice, S.input.parseDraft(draft()));
  // The vendor contact block, the justification and the per-line coding used to live only in the
  // browser, so a session ending silently emptied them. They are part of the record now.
  assert.equal(saved.vendorAddress, "1200 Vendor Way");
  assert.equal(saved.vendorCity, "Los Angeles, CA 90015");
  assert.equal(saved.vendorEmail, "orders@northstar.example");
  assert.match(saved.justification, /^Site code entered by hand/);
  assert.equal(saved.lineItems[0].expenseType, "Program Supplies");
  assert.equal(saved.lineItems[0].club, "STEM");
  assert.equal(saved.lineItems[0].splitSite, "7704");

  const reread = await S.getRequest(alice, saved.id);
  assert.equal(reread.vendorAddress, saved.vendorAddress);
  assert.equal(reread.lineItems[0].club, "STEM");
  await S.deleteDraft(alice, saved.id);
});

await check("a malformed vendor email is refused, and an absent one is fine", () => {
  assert.throws(() => S.input.parseDraft(draft({ vendorEmail: "not-an-address" })), /valid email/);
  assert.equal(S.input.parseDraft(draft({ vendorEmail: "" })).vendorEmail, "");
});

await check("a line's expense type is held to the server's own list", () => {
  assert.throws(
    () => S.input.parseDraft(draft({ lineItems: [{ description: "x", quantity: 1, unitPrice: 5, expenseType: "Bribes" }] })),
    /not a permitted value/,
  );
});

// ---- ladder and vocabulary parity with the design system -------------------------------------------

await check("the server's approval ladder matches the design system's tiers", () => {
  assert.deepEqual(
    S.APPROVAL_LADDER.map(tier => [tier.max, tier.role]),
    S.APPROVAL_TIERS.map(tier => [tier.max, tier.role]),
  );
});

await check("payment and expense vocabularies match the design system's", () => {
  assert.deepEqual([...S.input.PAYMENT_TYPES], S.DEFAULT_PAYMENT_TYPES.map(([value]) => value));
  assert.deepEqual([...S.input.EXPENSE_TYPES], [...S.DEFAULT_EXPENSE_TYPES]);
});

// ---- retired sites and uploaded files ---------------------------------------------------------------

await check("retired 99xx site codes are excluded", () => {
  assert.equal(S.isRetiredSite("9901"), true);
  assert.equal(S.isRetiredSite("9920"), true);
  assert.equal(S.isRetiredSite(" 9955 "), true);
  assert.equal(S.isRetiredSite("7704"), false);
  assert.equal(S.isRetiredSite("1199"), false);
  assert.equal(S.isRetiredSite(""), false);
});

const bytesFor = (...leading) => {
  const buffer = Buffer.alloc(64);
  leading.forEach((byte, index) => { buffer[index] = byte; });
  return buffer;
};
const PDF = bytesFor(0x25, 0x50, 0x44, 0x46);
const PNG = bytesFor(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG = bytesFor(0xff, 0xd8, 0xff);

await check("an upload is accepted only when its name and its bytes agree", () => {
  assert.equal(S.uploads.validateUpload({ name: "quote.pdf", type: "application/pdf", size: 64 }, PDF).type, "application/pdf");
  assert.equal(S.uploads.validateUpload({ name: "receipt.PNG", type: "image/png", size: 64 }, PNG).type, "image/png");
  assert.equal(S.uploads.validateUpload({ name: "invoice.jpeg", type: "image/jpeg", size: 64 }, JPG).type, "image/jpeg");
});

await check("executables and scripts are refused whatever they are called", () => {
  for (const name of ["payload.exe", "run.sh", "go.bat", "app.js", "page.html", "icon.svg"]) {
    assert.throws(() => S.uploads.validateUpload({ name, type: "application/pdf", size: 64 }, PDF), /program or script|not a PDF/);
  }
});

await check("a file renamed to look like a PDF is refused on its bytes", () => {
  // The name says PDF and the declared type says PDF; only the leading bytes give it away.
  const disguised = bytesFor(0x4d, 0x5a);
  assert.throws(() => S.uploads.validateUpload({ name: "invoice.pdf", type: "application/pdf", size: 64 }, disguised), /not really a PDF/);
});

await check("uploads are capped at 10 MB and cannot be empty", () => {
  const huge = Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)]);
  assert.throws(() => S.uploads.validateUpload({ name: "big.pdf", type: "application/pdf", size: huge.length }, huge), /larger than 10 MB/);
  assert.throws(() => S.uploads.validateUpload({ name: "empty.pdf", type: "application/pdf", size: 0 }, Buffer.alloc(0)), /is empty/);
});

await check("a filename cannot escape its directory or carry markup", () => {
  assert.equal(S.uploads.safeFilename("../../etc/passwd"), "passwd");
  assert.equal(S.uploads.safeFilename("in<script>.pdf"), "inscript.pdf");
  assert.equal(S.uploads.safeFilename(""), "attachment");
});

// ---- the signing ladder ----------------------------------------------------------------------------

await check("each position carries its own signing limit", () => {
  assert.equal(S.approvalLimit("REQUESTER"), 0);
  assert.equal(S.approvalLimit("MANAGER"), 5000);
  assert.equal(S.approvalLimit("DIRECTOR"), 15000);
  assert.equal(S.approvalLimit("SENIOR_DIRECTOR"), 25000);
  assert.equal(S.approvalLimit("CHIEF"), 75000);
  assert.equal(S.approvalLimit("CFO"), Infinity);
  assert.equal(S.approvalLimit("CEO"), Infinity);
  // Administering the system is not the same power as authorising money.
  assert.equal(S.approvalLimit("FINANCE"), 0);
  assert.equal(S.approvalLimit("ADMIN"), 0);
  assert.equal(S.isAdmin("FINANCE"), true);
  assert.equal(S.isApprover("FINANCE"), false);
});

await check("a position can approve up to its limit and no further", () => {
  assert.equal(S.canApprove("MANAGER", 4999), true);
  assert.equal(S.canApprove("MANAGER", 5000), true);
  assert.equal(S.canApprove("MANAGER", 5001), false);
  assert.equal(S.canApprove("CHIEF", 75000), true);
  assert.equal(S.canApprove("CHIEF", 75001), false);
  assert.equal(S.canApprove("CEO", 9_000_000), true);
  assert.equal(S.canApprove("REQUESTER", 1), false);
});

await check("roles stored before the ladder existed resolve to Director", () => {
  assert.equal(S.normalizeRole("APPROVER"), "DIRECTOR");
  assert.equal(S.normalizeRole("nonsense"), "REQUESTER");
  assert.equal(S.normalizeRole("CFO"), "CFO");
});

// ---- status machine --------------------------------------------------------------------------------

await check("no transition returns a submitted or approved PRF to Draft", () => {
  assert.throws(() => S.assertTransition("Awaiting Approval", "Draft"), /cannot become Draft/);
  assert.throws(() => S.assertTransition("Approved", "Draft"), /cannot become Draft/);
  assert.throws(() => S.assertTransition("Returned", "Draft"), /cannot become Draft/);
  assert.throws(() => S.assertTransition("Approved", "Awaiting Approval"), /cannot become/);
});

// ---- the lifecycle, with both requesters and the approver acting -----------------------------------

let alicePrf;

await check("a requester can create a draft", async () => {
  alicePrf = await S.createDraft(alice, S.input.parseDraft(draft()));
  assert.equal(alicePrf.status, "Draft");
  assert.equal(alicePrf.ownerId, alice.userId);
  assert.equal(alicePrf.amount, 7800);
  assert.equal(alicePrf.audit.length, 1);
});

await check("an approver cannot create a purchase request", async () => {
  await rejects(() => S.createDraft(approver, S.input.parseDraft(draft())), "Only requesters can create");
});

await check("another requester cannot see the draft in their list", async () => {
  const mine = await S.listRequests(bob);
  assert.equal(mine.length, 0);
});

await check("another requester gets Not Found rather than Forbidden for someone else's PRF", async () => {
  await rejects(() => S.getRequest(bob, alicePrf.id), "NotFoundError");
});

await check("an approver sees the whole register", async () => {
  const all = await S.listRequests(approver);
  assert.equal(all.length, 1);
});

await check("another requester cannot edit or delete a PRF that is not theirs", async () => {
  await rejects(() => S.updateDraft(bob, alicePrf.id, S.input.parseDraft(draft())), "NotFoundError");
  await rejects(() => S.deleteDraft(bob, alicePrf.id), "NotFoundError");
});

await check("submission requires a signature and a complete record", async () => {
  await rejects(() => S.submitRequest(alice, alicePrf.id, ""), "signature is required");
  const bare = await S.createDraft(alice, S.input.parseDraft(draft({ vendor: "", lineItems: [] })));
  await rejects(() => S.submitRequest(alice, bare.id, "Alice Requester"), "A vendor is required before submitting");
  await S.deleteDraft(alice, bare.id);
});

await check("submitting signs, routes by amount, and records both in the audit trail", async () => {
  const before = alicePrf.audit.length;
  alicePrf = await S.submitRequest(alice, alicePrf.id, "Alice Requester");
  assert.equal(alicePrf.status, "Awaiting Approval");
  assert.equal(alicePrf.requesterSigned, true);
  assert.equal(alicePrf.approvals[1].role, "Director"); // $7,800 lands in the $5,001–$15,000 band
  assert.equal(alicePrf.audit.length, before + 2);
  assert.ok(alicePrf.audit.some(entry => entry.action.includes("Routed for approval")));
});

await check("a submitted PRF can no longer be edited or deleted by its requester", async () => {
  await rejects(() => S.updateDraft(alice, alicePrf.id, S.input.parseDraft(draft())), "can no longer be edited");
  await rejects(() => S.deleteDraft(alice, alicePrf.id), "unsubmitted draft");
});

await check("a requester cannot approve anything, including their own request", async () => {
  await rejects(
    () => S.decideRequest(alice, alicePrf.id, { action: "approve", comment: "", signature: "Alice" }),
    "Only approvers can review",
  );
});

await check("sending back requires a comment", async () => {
  await rejects(
    () => S.decideRequest(approver, alicePrf.id, { action: "reject", comment: "", signature: "" }),
    "comment is required",
  );
});

await check("a send-back records the reason and reopens the PRF for editing", async () => {
  alicePrf = await S.decideRequest(approver, alicePrf.id, {
    action: "reject",
    comment: "Attach the vendor quote and split the transport line onto its own PRF.",
    signature: "",
  });
  assert.equal(alicePrf.status, "Returned");
  assert.ok(alicePrf.reviewNote.startsWith("Attach the vendor quote"));
  assert.equal(alicePrf.audit.at(-1).actorName, approver.name);

  alicePrf = await S.updateDraft(alice, alicePrf.id, S.input.parseDraft(draft({ vendor: "Northstar Learning Ltd" })));
  assert.equal(alicePrf.vendor, "Northstar Learning Ltd");
  alicePrf = await S.submitRequest(alice, alicePrf.id, "Alice Requester");
  assert.equal(alicePrf.status, "Awaiting Approval");
});

await check("approval requires a signature and is terminal", async () => {
  await rejects(
    () => S.decideRequest(approver, alicePrf.id, { action: "approve", comment: "", signature: "" }),
    "signature is required",
  );
  alicePrf = await S.decideRequest(approver, alicePrf.id, { action: "approve", comment: "", signature: "Marcus Lee" });
  assert.equal(alicePrf.status, "Approved");
  assert.equal(alicePrf.approverSigned, true);
  assert.ok(alicePrf.approvedAt);
  await rejects(
    () => S.decideRequest(approver, alicePrf.id, { action: "reject", comment: "changed my mind", signature: "" }),
    "cannot become Returned",
  );
  await rejects(() => S.deleteDraft(alice, alicePrf.id), "unsubmitted draft");
});

await check("the audit trail only ever grew, and its earlier entries are untouched", async () => {
  const final = await S.getRequest(approver, alicePrf.id);
  const actions = final.audit.map(entry => entry.action);
  assert.deepEqual(actions.slice(0, 2), ["Draft created", "Submitted and electronically signed"]);
  // Seven events: created, submitted, routed, returned, saved, resubmitted, routed, approved.
  assert.equal(final.audit.length, 8);
  assert.ok(final.audit.every(entry => entry.id && entry.at && entry.actorName));
  // Every entry carries who did it, which is the point of keeping them.
  assert.equal(final.audit.filter(entry => entry.actorId === approver.userId).length, 2);
});

await check("a second requester's PRF stays invisible to the first", async () => {
  const bobPrf = await S.createDraft(bob, S.input.parseDraft(draft({ vendor: "City Office Supply" })));
  const aliceSees = await S.listRequests(alice);
  assert.ok(!aliceSees.some(entry => entry.id === bobPrf.id));
  assert.ok((await S.listRequests(approver)).some(entry => entry.id === bobPrf.id));
  await rejects(() => S.getRequest(alice, bobPrf.id), "NotFoundError");
});


await check("an approver cannot sign off more than their position allows", async () => {
  const big = await S.createDraft(alice, S.input.parseDraft(draft({
    lineItems: [{ description: "Outdoor education equipment package", quantity: 1, unitPrice: 48900 }],
  })));
  const submitted = await S.submitRequest(alice, big.id, "Alice Requester");
  assert.equal(submitted.amount, 48900);

  // $48,900 needs a Chief. A Manager and a Director may both look at it and neither may approve it.
  await rejects(() => S.decideRequest(manager, big.id, { action: "approve", comment: "", signature: "Marcus" }), "authority covers up to");
  await rejects(() => S.decideRequest(approver, big.id, { action: "approve", comment: "", signature: "Ana" }), "Chief approval");

  // Sending it back is open to any approver — spotting a problem needs no signing authority.
  const returned = await S.decideRequest(manager, big.id, { action: "reject", comment: "Split this across two PRFs.", signature: "" });
  assert.equal(returned.status, "Returned");
});

await check("Finance administers but cannot authorise spending", async () => {
  const prf = await S.createDraft(alice, S.input.parseDraft(draft()));
  const submitted = await S.submitRequest(alice, prf.id, "Alice Requester");
  await rejects(() => S.decideRequest(finance, prf.id, { action: "approve", comment: "", signature: "Tomas" }), "Only approvers");
  // ...but Finance still sees the whole register.
  assert.ok((await S.listRequests(finance)).some(entry => entry.id === submitted.id));
});

await check("only Finance or an administrator reassigns a position, and never their own", async () => {
  await S.upsertUser({ id: finance.userId, email: finance.email, firstName: "Tomas", lastName: "Reyes", name: finance.name, contactEmail: finance.email, role: "FINANCE", district: "W", school: "Finance", passwordHash: "" });
  await S.upsertUser({ id: alice.userId, email: alice.email, firstName: "Alice", lastName: "Requester", name: alice.name, contactEmail: alice.email, role: "REQUESTER", district: "D4", school: "CHS", passwordHash: "" });

  await rejects(() => S.assignRole(alice, alice.userId, "CEO"), "Only Finance and administrators");
  await rejects(() => S.assignRole(finance, finance.userId, "CEO"), "cannot change your own position");
  const promoted = await S.assignRole(finance, alice.userId, "MANAGER");
  assert.equal(promoted.role, "MANAGER");
  await S.assignRole(finance, alice.userId, "REQUESTER");
});

await check("a copied-in colleague is notified of the outcome, and the approver of the submission", async () => {
  const prf = await S.createDraft(alice, S.input.parseDraft(draft({ copyName: "Site Lead", copyEmail: "lead@woodcraftrangers.org" })));
  await S.upsertUser({ id: approver.userId, email: approver.email, firstName: "Ana", lastName: "Rivera", name: approver.name, contactEmail: approver.email, role: "DIRECTOR", district: "W", school: "Programs", passwordHash: "" });
  await S.submitRequest(alice, prf.id, "Alice Requester");

  const waiting = await S.listNotifications(approver);
  assert.ok(waiting.some(entry => entry.kind === "submitted" && entry.requestId === prf.id));

  await S.decideRequest(approver, prf.id, { action: "approve", comment: "", signature: "Ana Rivera" });
  assert.ok((await S.listNotifications(alice)).some(entry => entry.kind === "approved" && entry.requestId === prf.id));
  const copied = await S.listNotifications({ ...alice, userId: "someone-else", email: "lead@woodcraftrangers.org" });
  assert.ok(copied.some(entry => entry.kind === "approved" && entry.requestId === prf.id));
});

await check("a malformed copy address is refused", () => {
  assert.throws(() => S.input.parseDraft(draft({ copyEmail: "not-an-address" })), /valid email/);
  assert.equal(S.input.parseDraft(draft({ copyEmail: "" })).copyEmail, "");
});

// ---- sessions --------------------------------------------------------------------------------------

const user = { id: "u-alice", email: alice.email, name: alice.name, role: "REQUESTER", district: "D4", school: "CHS" };

await check("a freshly minted session validates and slides its idle window forward", async () => {
  const started = S.startSession(user);
  const check1 = await S.readSessionToken(started.token);
  assert.equal(check1.ok, true);
  assert.equal(check1.session.userId, user.id);
  assert.ok(check1.session.lastSeen >= started.session.lastSeen);
});

await check("a tampered payload or signature is refused", async () => {
  const started = S.startSession(user);
  const [payload, signature] = started.token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...started.session, role: "APPROVER" }), "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  assert.equal((await S.readSessionToken(`${forged}.${signature}`)).ok, false);
  assert.equal((await S.readSessionToken(`${payload}.${signature.slice(0, -2)}xx`)).ok, false);
  assert.equal((await S.readSessionToken("not-a-token")).ok, false);
  assert.equal((await S.readSessionToken(undefined)).ok, false);
});

await check("a background request is served without extending the idle window", async () => {
  const started = S.startSession(user);
  const earlier = { ...started.session, lastSeen: Date.now() - 30 * 60 * 1000 };
  const token = S.encodeSession(earlier);

  // A background save is honoured, but leaves lastSeen exactly where it was: half an hour in the past.
  const quiet = await S.readSessionToken(token, { slide: false });
  assert.equal(quiet.ok, true);
  assert.equal(quiet.session.lastSeen, earlier.lastSeen);
  assert.equal(quiet.token, token);

  // A user-driven request moves it to now, which is what keeps an active signer signed in.
  const active = await S.readSessionToken(token);
  assert.equal(active.ok, true);
  assert.ok(active.session.lastSeen > earlier.lastSeen);
});

await check("background requests cannot keep an abandoned session alive", async () => {
  const started = S.startSession(user);
  // An editor left open on an empty desk: the last real interaction was over an hour ago, and only
  // autosaves have happened since. The session is over regardless of how many of those there were.
  const abandoned = { ...started.session, lastSeen: Date.now() - S.IDLE_TIMEOUT_MS - 1000 };
  const result = await S.readSessionToken(S.encodeSession(abandoned), { slide: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "idle");
});

await check("a session idle for more than an hour is refused", async () => {
  const started = S.startSession(user);
  const stale = { ...started.session, lastSeen: Date.now() - S.IDLE_TIMEOUT_MS - 1000 };
  const result = await S.readSessionToken(S.encodeSession(stale));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "idle");
});

await check("a session past its absolute lifetime is refused however active it has been", async () => {
  const started = S.startSession(user);
  const old = { ...started.session, issuedAt: Date.now() - S.ABSOLUTE_TIMEOUT_MS - 1000, lastSeen: Date.now() };
  const result = await S.readSessionToken(S.encodeSession(old));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "expired");
});

await check("signing out revokes the token, not just the cookie", async () => {
  const started = S.startSession(user);
  assert.equal((await S.readSessionToken(started.token)).ok, true);
  await S.endSession(started.session);
  const replayed = await S.readSessionToken(started.token);
  assert.equal(replayed.ok, false);
  assert.equal(replayed.reason, "revoked");
});

// ---- passwords -------------------------------------------------------------------------------------

await check("password hashing round-trips and rejects the wrong password", async () => {
  const stored = await S.hashPassword("correct horse battery staple");
  assert.ok(stored.startsWith("scrypt:"));
  assert.equal(await S.verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await S.verifyPassword("wrong", stored), false);
  assert.equal(await S.verifyPassword("anything", undefined), false);
  assert.equal(await S.verifyPassword("anything", "garbage"), false);
});

// ---- report ----------------------------------------------------------------------------------------

await fs.rm(tmp, { recursive: true, force: true });
await fs.rm(buildDir, { recursive: true, force: true });

if (failures.length) {
  console.error(`
  ✗ ${failures.length} of ${passed + failures.length} authorisation checks FAILED
`);
  failures.forEach(line => console.error(`    ${line}
`));
  process.exit(1);
}
console.log(`
  ✓ ${passed} authorisation, session and input checks passed
`);
