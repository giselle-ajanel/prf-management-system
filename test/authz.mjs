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
const approver = { userId: "u-appr", email: "director@woodcraftrangers.org", name: "Ana Rivera", role: "APPROVER", tier: "DIRECTOR" };
const manager = { userId: "u-mgr", email: "manager@woodcraftrangers.org", name: "Marcus Lee", role: "APPROVER", tier: "MANAGER" };
const chief = { userId: "u-chief", email: "chief@woodcraftrangers.org", name: "Daniel Okafor", role: "APPROVER", tier: "CHIEF" };
const finance = { userId: "u-fin", email: "finance@woodcraftrangers.org", name: "Tomas Reyes", role: "FINANCE_REVIEWER" };
const financeAdmin = { userId: "u-fadm", email: "financeadmin@woodcraftrangers.org", name: "Elena Petrov", role: "FINANCE_ADMIN" };
const viewer = { userId: "u-view", email: "viewonly@woodcraftrangers.org", name: "Auditor Reid", role: "VIEW_ONLY" };

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

// ---- roles and tiers -------------------------------------------------------------------------------

await check("capabilities are cumulative, and Finance holds no signing authority", () => {
  // Everyone who works here buys things; only a read-only viewer cannot raise a request.
  for (const role of ["REQUESTER", "APPROVER", "FINANCE_REVIEWER", "FINANCE_ADMIN"]) {
    assert.equal(S.canRequest(role), true, `${role} should be able to request`);
  }
  assert.equal(S.canRequest("VIEW_ONLY"), false);

  assert.equal(S.isApprover("APPROVER"), true);
  assert.equal(S.isApprover("FINANCE_ADMIN"), false, "administering is not signing authority");
  assert.equal(S.isFinance("FINANCE_REVIEWER"), true);
  assert.equal(S.isFinance("FINANCE_ADMIN"), true);
  assert.equal(S.isAdmin("FINANCE_REVIEWER"), false, "a reviewer does not administer the system");
  assert.equal(S.isAdmin("FINANCE_ADMIN"), true);
  // Everyone but a plain requester reads the organisation's submitted register.
  assert.equal(S.seesRegister("REQUESTER"), false);
  assert.equal(S.seesRegister("VIEW_ONLY"), true);
});

await check("each tier carries its own limit, and an amount picks the lowest tier that covers it", () => {
  assert.equal(S.tierLimit("MANAGER"), 5000);
  assert.equal(S.tierLimit("DIRECTOR"), 15000);
  assert.equal(S.tierLimit("CHIEF"), 75000);
  assert.equal(S.tierLimit(undefined), 0);
  assert.equal(S.tierForAmount(4999), "MANAGER");
  assert.equal(S.tierForAmount(5001), "DIRECTOR");
  assert.equal(S.tierForAmount(48900), "CHIEF");
  assert.equal(S.tierForAmount(300000), "CFO", "CFO and CEO both cover any amount; CFO is the lower of the two");
  assert.equal(S.nextTierAbove("MANAGER"), "DIRECTOR");
  assert.equal(S.nextTierAbove("CEO"), "CEO");
});

await check("accounts stored under the old ladder-as-role model read forward", () => {
  assert.deepEqual(S.normalizeRole("DIRECTOR"), { role: "APPROVER", tier: "DIRECTOR" });
  // "APPROVER" is also the new role name, so it resolves as one; the missing band is defaulted at load.
  assert.deepEqual(S.normalizeRole("APPROVER"), { role: "APPROVER" });
  assert.deepEqual(S.normalizeRole("FINANCE"), { role: "FINANCE_ADMIN" });
  assert.deepEqual(S.normalizeRole("REQUESTER"), { role: "REQUESTER" });
  assert.equal(S.normalizeStatus("Awaiting Approval"), "Pending Supervisor Approval");
  assert.equal(S.normalizeStatus("Returned"), "Needs Revision");
  assert.equal(S.normalizeStatus("Approved"), "Approved");
});

// ---- status machine ---// ---- status machine --------------------------------------------------------------------------------

await check("the two gates are the only route to Approved, and nothing returns to Draft", () => {
  assert.throws(() => S.assertTransition("Pending Supervisor Approval", "Draft"), /cannot become Draft/);
  assert.throws(() => S.assertTransition("Approved", "Draft"), /cannot become Draft/);
  assert.throws(() => S.assertTransition("Needs Revision", "Draft"), /cannot become Draft/);
  // Gate 1 cannot skip Finance and land on Approved.
  assert.throws(() => S.assertTransition("Pending Supervisor Approval", "Approved"), /cannot become Approved/);
  // Approved is terminal.
  assert.throws(() => S.assertTransition("Approved", "Pending Finance Review"), /cannot become/);
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

await check("everyone but a read-only viewer can raise a request", async () => {
  const byApprover = await S.createDraft(approver, S.input.parseDraft(draft()));
  assert.equal(byApprover.ownerId, approver.userId);
  await S.deleteDraft(approver, byApprover.id);
  await rejects(() => S.createDraft(viewer, S.input.parseDraft(draft())), "view-only account cannot create");
});

await check("another requester cannot see the draft in their list", async () => {
  const mine = await S.listRequests(bob);
  assert.equal(mine.length, 0);
});

await check("another requester gets Not Found rather than Forbidden for someone else's PRF", async () => {
  await rejects(() => S.getRequest(bob, alicePrf.id), "NotFoundError");
});

await check("an approver does not see a draft, even as the only request in the system", async () => {
  // Drafts are the requester's private working copy; the queue starts when they submit.
  assert.equal((await S.listRequests(approver)).length, 0);
  assert.equal((await S.listRequests(finance)).length, 0);
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
  assert.equal(alicePrf.status, "Pending Supervisor Approval");
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
    "Only approvers can sign off",
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
  assert.equal(alicePrf.status, "Needs Revision");
  assert.ok(alicePrf.reviewNote.startsWith("Attach the vendor quote"));
  assert.equal(alicePrf.audit.at(-1).actorName, approver.name);

  alicePrf = await S.updateDraft(alice, alicePrf.id, S.input.parseDraft(draft({ vendor: "Northstar Learning Ltd" })));
  assert.equal(alicePrf.vendor, "Northstar Learning Ltd");
  alicePrf = await S.submitRequest(alice, alicePrf.id, "Alice Requester");
  assert.equal(alicePrf.status, "Pending Supervisor Approval");
});

await check("gate 1 hands the request to Finance rather than finishing it", async () => {
  await rejects(
    () => S.decideRequest(approver, alicePrf.id, { action: "approve", comment: "", signature: "" }),
    "signature is required",
  );
  alicePrf = await S.decideRequest(approver, alicePrf.id, { action: "approve", comment: "", signature: "Ana Rivera" });
  assert.equal(alicePrf.status, "Pending Finance Review");
  assert.equal(alicePrf.approverSigned, true);
  assert.equal(alicePrf.approverName, approver.name);
  // The approver is done with it; acting again is refused rather than signing twice.
  await rejects(
    () => S.decideRequest(approver, alicePrf.id, { action: "reject", comment: "changed my mind", signature: "" }),
    "already been approved and is with Finance",
  );
  await rejects(() => S.deleteDraft(alice, alicePrf.id), "unsubmitted draft");
});

await check("gate 2 is Finance's, and only Finance can close it", async () => {
  await rejects(
    () => S.financeReview(approver, alicePrf.id, { action: "approve", comment: "", signature: "Ana" }),
    "Only Finance can complete",
  );
  await rejects(
    () => S.financeReview(finance, alicePrf.id, { action: "approve", comment: "", signature: "" }),
    "signature is required",
  );
  alicePrf = await S.financeReview(finance, alicePrf.id, { action: "approve", comment: "Coding checks out.", signature: "Tomas Reyes" });
  assert.equal(alicePrf.status, "Approved");
  assert.equal(alicePrf.financeSigned, true);
  assert.equal(alicePrf.financeName, finance.name);
  assert.ok(alicePrf.completedAt);
  // Final and read-only: neither gate can reopen it.
  await rejects(() => S.financeReview(finance, alicePrf.id, { action: "reject", comment: "second thoughts", signature: "" }), "cannot become");
  await rejects(() => S.decideRequest(approver, alicePrf.id, { action: "reject", comment: "no", signature: "" }), "cannot become");
});

await check("the audit trail only ever grew, and its earlier entries are untouched", async () => {
  const final = await S.getRequest(approver, alicePrf.id);
  const actions = final.audit.map(entry => entry.action);
  assert.deepEqual(actions.slice(0, 2), ["Draft created", "Submitted and electronically signed"]);
  // Created, submitted, routed, returned, saved, resubmitted, routed, approved, sent to Finance, cleared.
  assert.equal(final.audit.length, 10);
  assert.ok(final.audit.every(entry => entry.id && entry.at && entry.actorName));
  // Every entry carries who did it, which is the point of keeping them.
  // The approver appears twice: the return, and the signature. The hand-off to Finance is the system.
  assert.equal(final.audit.filter(entry => entry.actorId === approver.userId).length, 2);
  assert.ok(final.audit.some(entry => entry.action === "Cleared for payment by Finance"));
});

await check("a second requester's PRF stays invisible to the first", async () => {
  const bobPrf = await S.createDraft(bob, S.input.parseDraft(draft({ vendor: "City Office Supply" })));
  const aliceSees = await S.listRequests(alice);
  assert.ok(!aliceSees.some(entry => entry.id === bobPrf.id));
  await rejects(() => S.getRequest(alice, bobPrf.id), "NotFoundError");
  // And while it is still a draft, not even an approver or Finance sees it.
  assert.ok(!(await S.listRequests(approver)).some(entry => entry.id === bobPrf.id));
  assert.ok(!(await S.listRequests(finance)).some(entry => entry.id === bobPrf.id));
  // Once submitted, it joins the queue.
  await S.submitRequest(bob, bobPrf.id, "Bob Requester");
  assert.ok((await S.listRequests(approver)).some(entry => entry.id === bobPrf.id));
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
  // A Chief can, and it goes to Finance rather than straight to done.
  const cleared = await S.decideRequest(chief, big.id, { action: "approve", comment: "", signature: "Daniel Okafor" });
  assert.equal(cleared.status, "Pending Finance Review");

});


await check("only Finance or an administrator reassigns a position, and never their own", async () => {
  await S.upsertUser({ id: finance.userId, email: finance.email, firstName: "Tomas", lastName: "Reyes", name: finance.name, contactEmail: finance.email, role: "FINANCE_REVIEWER", district: "W", school: "Finance", passwordHash: "" });
  await S.upsertUser({ id: financeAdmin.userId, email: financeAdmin.email, firstName: "Elena", lastName: "Petrov", name: financeAdmin.name, contactEmail: financeAdmin.email, role: "FINANCE_ADMIN", district: "W", school: "Finance", passwordHash: "" });
  await S.upsertUser({ id: alice.userId, email: alice.email, firstName: "Alice", lastName: "Requester", name: alice.name, contactEmail: alice.email, role: "REQUESTER", district: "D4", school: "CHS", passwordHash: "" });

  await rejects(() => S.assignRole(alice, alice.userId, "FINANCE_ADMIN"), "Only Finance and administrators");
  await rejects(() => S.assignRole(financeAdmin, financeAdmin.userId, "REQUESTER"), "cannot change your own position");
  const promoted = await S.assignRole(financeAdmin, alice.userId, "APPROVER");
  assert.equal(promoted.role, "APPROVER");
  await S.assignRole(financeAdmin, alice.userId, "REQUESTER");
});


await check("a malformed copy address is refused", () => {
  assert.throws(() => S.input.parseDraft(draft({ copyEmail: "not-an-address" })), /valid email/);
  assert.equal(S.input.parseDraft(draft({ copyEmail: "" })).copyEmail, "");
});

await check("nobody but the requester ever sees a draft", async () => {
  const secret = await S.createDraft(alice, S.input.parseDraft(draft({ vendor: "Half-typed vendor" })));
  for (const viewer_ of [approver, manager, finance, financeAdmin, viewer, bob]) {
    const seen = await S.listRequests(viewer_);
    assert.ok(!seen.some(entry => entry.id === secret.id), `${viewer_.role} could see a draft`);
    await rejects(() => S.getRequest(viewer_, secret.id), "NotFoundError");
  }
  assert.ok((await S.listRequests(alice)).some(entry => entry.id === secret.id));
  await S.deleteDraft(alice, secret.id);
});

await check("gate 1 is the approvers' queue, and Finance cannot see into it", async () => {
  const waiting = await S.createDraft(alice, S.input.parseDraft(draft()));
  await S.submitRequest(alice, waiting.id, "Alice Requester");

  // Approvers see it; Finance does not, because it has not cleared gate 1.
  assert.ok((await S.listRequests(approver)).some(entry => entry.id === waiting.id));
  assert.ok(!(await S.listRequests(finance)).some(entry => entry.id === waiting.id));
  await rejects(() => S.getRequest(finance, waiting.id), "NotFoundError");
  // And acting on it is refused rather than merely hidden.
  await rejects(
    () => S.financeReview(finance, waiting.id, { action: "approve", comment: "", signature: "Tomas" }),
    "NotFoundError",
  );

  // After the signature it becomes Finance's, and leaves the queues of approvers who did not sign it.
  const signed = await S.decideRequest(approver, waiting.id, { action: "approve", comment: "", signature: "Ana Rivera" });
  assert.equal(signed.status, "Pending Finance Review");
  assert.ok((await S.listRequests(finance)).some(entry => entry.id === waiting.id));
  assert.ok(!(await S.listRequests(manager)).some(entry => entry.id === waiting.id), "an approver who did not sign it should not still hold it");
  // The approver who signed it can still follow it through Finance.
  assert.ok((await S.listRequests(approver)).some(entry => entry.id === waiting.id));

  const done = await S.financeReview(finance, waiting.id, { action: "approve", comment: "", signature: "Tomas Reyes" });
  assert.equal(done.status, "Approved");
  // A read-only viewer sees the completed record and cannot act on it.
  assert.ok((await S.listRequests(viewer)).some(entry => entry.id === waiting.id));
  await rejects(() => S.decideRequest(viewer, waiting.id, { action: "reject", comment: "no", signature: "" }), "Only approvers");
});

await check("a returned request follows whoever returned it, from either gate", async () => {
  const sent = await S.createDraft(alice, S.input.parseDraft(draft()));
  await S.submitRequest(alice, sent.id, "Alice Requester");
  const returned = await S.decideRequest(manager, sent.id, { action: "reject", comment: "Attach the quote.", signature: "" });
  assert.equal(returned.status, "Needs Revision");
  assert.equal(returned.returnedBy, manager.userId);
  assert.equal(returned.returnedStage, "supervisor");

  assert.ok((await S.listRequests(manager)).some(entry => entry.id === sent.id));
  assert.ok(!(await S.listRequests(approver)).some(entry => entry.id === sent.id));
  assert.ok((await S.listRequests(alice)).some(entry => entry.id === sent.id));
  assert.ok((await S.listRequests(financeAdmin)).some(entry => entry.id === sent.id));

  // Resubmitted, approved, then returned by Finance: the stage is recorded so the requester knows which
  // kind of problem they are fixing.
  await S.submitRequest(alice, sent.id, "Alice Requester");
  await S.decideRequest(approver, sent.id, { action: "approve", comment: "", signature: "Ana Rivera" });
  const bounced = await S.financeReview(finance, sent.id, { action: "reject", comment: "Funding code is for FY26.", signature: "" });
  assert.equal(bounced.status, "Needs Revision");
  assert.equal(bounced.returnedStage, "finance");
  assert.match(bounced.audit.at(-1).detail, /^Fiscal issue:/);
});

await check("both signatures are recorded with names and immutable ids", async () => {
  const prf = await S.createDraft(alice, S.input.parseDraft(draft()));
  await S.submitRequest(alice, prf.id, "Alice Requester");
  const signed = await S.decideRequest(approver, prf.id, { action: "approve", comment: "", signature: "Ana Rivera" });
  assert.equal(signed.approverName, approver.name);
  assert.equal(signed.approverId, approver.userId);
  const done = await S.financeReview(finance, prf.id, { action: "approve", comment: "", signature: "Tomas Reyes" });
  assert.equal(done.financeName, finance.name);
  assert.equal(done.financeId, finance.userId);
  assert.ok(done.audit.some(entry => entry.actorId === approver.userId));
  assert.ok(done.audit.some(entry => entry.actorId === finance.userId));
});

await check("an approver's own request escalates past their own tier", async () => {
  // A Manager's $3,000 request would sit in a Manager's queue — their own. It escalates to Director.
  const own = await S.createDraft(manager, S.input.parseDraft(draft({
    lineItems: [{ description: "Team supplies", quantity: 1, unitPrice: 3000 }],
  })));
  const submitted = await S.submitRequest(manager, own.id, "Marcus Lee");
  assert.equal(submitted.requiredTier, "DIRECTOR");
  await rejects(() => S.decideRequest(manager, own.id, { action: "approve", comment: "", signature: "Marcus" }), "cannot approve a request you submitted");
  const signed = await S.decideRequest(approver, own.id, { action: "approve", comment: "", signature: "Ana Rivera" });
  assert.equal(signed.status, "Pending Finance Review");
});

await check("everyone in the chain is notified at the stage that concerns them", async () => {
  const prf = await S.createDraft(alice, S.input.parseDraft(draft({ copyName: "Site Lead", copyEmail: "lead@woodcraftrangers.org" })));
  await S.upsertUser({ id: approver.userId, email: approver.email, firstName: "Ana", lastName: "Rivera", name: approver.name, contactEmail: approver.email, role: "APPROVER", tier: "DIRECTOR", district: "W", school: "Programs", passwordHash: "" });
  await S.upsertUser({ id: finance.userId, email: finance.email, firstName: "Tomas", lastName: "Reyes", name: finance.name, contactEmail: finance.email, role: "FINANCE_REVIEWER", district: "W", school: "Finance", passwordHash: "" });
  await S.submitRequest(alice, prf.id, "Alice Requester");

  // Gate 1: the approvers who could sign it.
  assert.ok((await S.listNotifications(approver)).some(entry => entry.kind === "submitted" && entry.requestId === prf.id));

  await S.decideRequest(approver, prf.id, { action: "approve", comment: "", signature: "Ana Rivera" });
  // Gate 2: Finance is told there is something to review.
  assert.ok((await S.listNotifications(finance)).some(entry => entry.requestId === prf.id && /Finance review/.test(entry.title)));

  await S.financeReview(finance, prf.id, { action: "approve", comment: "", signature: "Tomas Reyes" });
  // Completion: the requester and the copied-in colleague.
  assert.ok((await S.listNotifications(alice)).some(entry => entry.requestId === prf.id && /approved and complete/.test(entry.title)));
  const copied = await S.listNotifications({ ...alice, userId: "someone-else", email: "lead@woodcraftrangers.org" });
  assert.ok(copied.some(entry => entry.requestId === prf.id && /approved and complete/.test(entry.title)));
});

await check("a rename is logged, and the log is append-only", async () => {
  await S.upsertUser({ id: "u-rename", email: "manager@woodcraftrangers.org", firstName: "Marcus", lastName: "Lee", name: "Marcus Lee", contactEmail: "manager@woodcraftrangers.org", role: "APPROVER", tier: "MANAGER", district: "W", school: "Ops", passwordHash: "" });
  const actor = { userId: "u-rename", email: "manager@woodcraftrangers.org", name: "Marcus Lee", role: "APPROVER", tier: "MANAGER" };

  const renamed = await S.updateProfile(actor, { firstName: "Jane", lastName: "Doe", contactEmail: "jane.doe@woodcraftrangers.org" });
  assert.equal(renamed.name, "Jane Doe");
  assert.equal(renamed.role, "APPROVER", "a rename must not touch the position");

  const log = await S.listAccountLog(financeAdmin);
  const rename = log.find(entry => entry.subjectId === "u-rename" && entry.action === "Display name changed");
  assert.ok(rename, "the rename was not logged");
  assert.match(rename.detail, /"Marcus Lee" to "Jane Doe"/);
  assert.equal(rename.actorId, "u-rename");
  assert.ok(log.some(entry => entry.action === "Contact address changed"));

  // A requester cannot read the account log at all.
  await rejects(() => S.listAccountLog(alice), "Only Finance and administrators");
});

await check("a position change is logged against the administrator who made it", async () => {
  const before = (await S.listAccountLog(financeAdmin)).length;
  await S.assignRole(financeAdmin, "u-rename", "FINANCE_REVIEWER");
  const log = await S.listAccountLog(financeAdmin);
  assert.equal(log.length, before + 1);
  assert.equal(log[0].action, "Position changed");
  assert.equal(log[0].actorId, financeAdmin.userId);
  assert.equal(log[0].subjectId, "u-rename");
  assert.match(log[0].detail, /Approver to Finance Reviewer/);
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
