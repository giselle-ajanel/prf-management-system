// End-to-end checks against a running server.
//
//   node test/http.mjs
//
// test/authz.mjs proves the rules hold in the data layer. This proves they are actually wired to the
// routes — that the cookie, the CSRF token, the role check and the status codes behave over HTTP, which is
// the only surface an attacker has. It starts its own `next dev` against a throwaway store, so it never
// touches .secure-data/ or the credentials of a running instance.

import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "..");
const port = 3210 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "prf-http-"));

const server = spawn("npx", ["next", "dev", "-p", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    PRF_STORE_PATH: path.join(dataDir, "store.json"),
    PRF_SESSION_SECRET: "http-suite-secret-long-enough-to-be-accepted",
    // No identity header configured, so the SSO path stays off and the password path is under test.
    PRF_IDENTITY_HEADER: "x-prf-suite-never-set",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });

const stop = async () => {
  server.kill("SIGTERM");
  await fs.rm(dataDir, { recursive: true, force: true });
};

process.on("exit", () => server.kill("SIGKILL"));

// ---- cookie-aware client ---------------------------------------------------------------------------
// A jar per signed-in person, so one test's session cannot accidentally authorise another's request.

const jar = () => ({ cookies: new Map(), csrf: "" });

function remember(session, response) {
  for (const raw of response.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value) session.cookies.set(name, value);
    else session.cookies.delete(name);
    if (name === "prf_csrf") session.csrf = value;
  }
}

async function call(session, method, url, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (session.cookies.size) {
    headers.cookie = [...session.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && session.csrf && !("x-csrf-token" in headers)) headers["x-csrf-token"] = session.csrf;
  const response = await fetch(`${base}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  remember(session, response);
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { status: response.status, body: payload, headers: response.headers };
}

/** Reads the lastSeen stamp out of a session cookie, to see whether a request moved the idle clock. */
const lastSeenOf = session => {
  const token = session.cookies.get("prf_session") || "";
  const payload = token.split(".")[0].replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8")).lastSeen;
};

// ---- wait for the dev server -----------------------------------------------------------------------
const ready = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/auth/session`);
      if (response.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
};

if (!(await ready())) {
  console.error(`
  ✗ dev server did not start on ${base}
`);
  console.error(serverLog.slice(-2000));
  await stop();
  process.exit(1);
}

// ---- runner ----------------------------------------------------------------------------------------
let passed = 0;
const failures = [];
const check = async (name, work) => {
  try { await work(); passed += 1; }
  catch (error) { failures.push(`${name}: ${error && error.message}`); }
};

// ---- credentials -----------------------------------------------------------------------------------
// The first request seeds the demo accounts with random passwords and writes them beside the store.
const credentialsFile = path.join(dataDir, "seed-credentials.txt");
const credentials = {};
for (let attempt = 0; attempt < 20 && !Object.keys(credentials).length; attempt += 1) {
  try {
    const text = await fs.readFile(credentialsFile, "utf8");
    for (const row of text.split(String.fromCharCode(10))) {
      const match = /^(REQUESTER|APPROVER)\s+(\S+)\s+(\S+)$/.exec(row.trim());
      if (match) (credentials[match[1]] = credentials[match[1]] || []).push({ email: match[2], password: match[3] });
    }
  } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
}

const alice = jar(), maya = jar(), approver = jar(), stranger = jar();

await check("the demo accounts were seeded with generated passwords", () => {
  assert.equal(credentials.REQUESTER?.length, 2);
  assert.equal(credentials.APPROVER?.length, 1);
  assert.ok(credentials.REQUESTER[0].password.length >= 12);
});

// ---- unauthenticated -------------------------------------------------------------------------------

await check("an unauthenticated visitor is told to sign in, and reads nothing", async () => {
  const session = await call(stranger, "GET", "/api/auth/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.authenticated, false);

  const list = await call(stranger, "GET", "/api/requests");
  assert.equal(list.status, 401);
  assert.equal(list.body.authenticated, false);
  assert.equal(list.body.requests, undefined);
});

await check("every mutation is refused without a session", async () => {
  for (const [method, url] of [
    ["POST", "/api/requests"],
    ["PUT", "/api/requests/PRF-FY27-0001"],
    ["DELETE", "/api/requests/PRF-FY27-0001"],
    ["POST", "/api/requests/PRF-FY27-0001/submit"],
    ["POST", "/api/requests/PRF-FY27-0001/decision"],
  ]) {
    const response = await call(stranger, method, url, method === "DELETE" ? undefined : {});
    assert.equal(response.status, 401, `${method} ${url} returned ${response.status}`);
  }
});

await check("the export is refused without a session", async () => {
  assert.equal((await call(stranger, "GET", "/api/requests/export")).status, 401);
});

// ---- sign-in ---------------------------------------------------------------------------------------

await check("a wrong password is refused without revealing whether the account exists", async () => {
  const known = await call(jar(), "POST", "/api/auth/login", {
    email: credentials.REQUESTER[0].email,
    password: "not-the-password",
  });
  const unknown = await call(jar(), "POST", "/api/auth/login", {
    email: "nobody@woodcraftrangers.org",
    password: "not-the-password",
  });
  assert.equal(known.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(known.body.error, unknown.body.error);
});

await check("signing in issues an http-only session cookie and a CSRF token", async () => {
  const response = await call(alice, "POST", "/api/auth/login", credentials.REQUESTER[0]);
  assert.equal(response.status, 200);
  assert.equal(response.body.user.role, "REQUESTER");
  const cookies = response.headers.getSetCookie().join(" ");
  assert.match(cookies, /prf_session=/);
  assert.match(cookies, /HttpOnly/i);
  assert.ok(alice.csrf, "expected a readable CSRF cookie");
});

await check("the other accounts sign in too", async () => {
  assert.equal((await call(maya, "POST", "/api/auth/login", credentials.REQUESTER[1])).status, 200);
  const response = await call(approver, "POST", "/api/auth/login", credentials.APPROVER[0]);
  assert.equal(response.status, 200);
  assert.equal(response.body.user.role, "APPROVER");
});

// ---- CSRF ------------------------------------------------------------------------------------------

let alicePrf = "";

await check("a mutation without the CSRF header is refused", async () => {
  const response = await call(alice, "POST", "/api/requests", { vendor: "Northstar" }, { "x-csrf-token": "" });
  assert.equal(response.status, 403);
  assert.match(response.body.error, /CSRF/);
});

await check("a mutation carrying another session's CSRF token is refused", async () => {
  const response = await call(alice, "POST", "/api/requests", { vendor: "Northstar" }, { "x-csrf-token": approver.csrf });
  assert.equal(response.status, 403);
});

await check("a cross-origin mutation is refused even with the right token", async () => {
  const response = await call(alice, "POST", "/api/requests", { vendor: "Northstar" }, { origin: "https://evil.example" });
  assert.equal(response.status, 403);
  assert.match(response.body.error, /Cross-origin/);
});

// ---- the requester's own data ----------------------------------------------------------------------

await check("a requester can create a draft, and the whole form is stored", async () => {
  const response = await call(alice, "POST", "/api/requests", {
    vendor: "Northstar Learning",
    vendorAddress: "1200 Vendor Way",
    vendorCity: "Los Angeles, CA 90015",
    vendorEmail: "orders@northstar.example",
    description: "24 robotics kits for the Grade 9 after-school STEM lab",
    justification: "Manual site code pending a workbook row.",
    district: "District 4",
    school: "Central High School",
    siteCode: "7704",
    fundingCode: "88STEM",
    paymentType: "direct",
    expenseType: "Program Supplies",
    lineItems: [
      { description: "Classroom robotics kit", quantity: 24, unitPrice: 325, expenseType: "Program Supplies", club: "STEM", splitSite: "7704" },
    ],
  });
  assert.equal(response.status, 201);
  const record = response.body.request;
  assert.equal(record.status, "Draft");
  assert.equal(record.amount, 7800);
  // The fields that used to live only in the browser and vanished when a session ended.
  assert.equal(record.vendorAddress, "1200 Vendor Way");
  assert.equal(record.vendorEmail, "orders@northstar.example");
  assert.match(record.justification, /^Manual site code/);
  assert.equal(record.lineItems[0].club, "STEM");
  alicePrf = record.id;
});

await check("the server ignores client-supplied status, owner and audit fields", async () => {
  const response = await call(alice, "PUT", `/api/requests/${alicePrf}`, {
    vendor: "Northstar Learning",
    description: "24 robotics kits for the Grade 9 after-school STEM lab",
    district: "District 4",
    school: "Central High School",
    siteCode: "7704",
    fundingCode: "88STEM",
    status: "Approved",
    ownerId: "u-someone-else",
    approverSigned: true,
    audit: [{ action: "forged entry" }],
    lineItems: [{ description: "Classroom robotics kit", quantity: 24, unitPrice: 325 }],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.request.status, "Draft");
  assert.equal(response.body.request.approverSigned, false);
  assert.ok(!response.body.request.audit.some(entry => entry.action === "forged entry"));
});

await check("an autosave marked background does not reset the idle clock", async () => {
  const before = lastSeenOf(alice);
  await new Promise(resolve => setTimeout(resolve, 1100));

  // A background save still stores its content...
  const saved = await call(alice, "PUT", `/api/requests/${alicePrf}`, {
    vendor: "Northstar Learning",
    description: "24 robotics kits for the Grade 9 after-school STEM lab",
    district: "District 4",
    school: "Central High School",
    siteCode: "7704",
    fundingCode: "88STEM",
    lineItems: [{ description: "Classroom robotics kit", quantity: 24, unitPrice: 325 }],
  }, { "x-prf-background": "1" });
  assert.equal(saved.status, 200);
  assert.equal(lastSeenOf(alice), before, "a background save moved the idle clock");

  // ...while an ordinary request from the same session does move it forward.
  await new Promise(resolve => setTimeout(resolve, 1100));
  await call(alice, "GET", "/api/requests");
  assert.ok(lastSeenOf(alice) > before, "a user-driven request failed to move the idle clock");
});

// ---- isolation between requesters ------------------------------------------------------------------

await check("another requester cannot list or read it", async () => {
  const list = await call(maya, "GET", "/api/requests");
  assert.equal(list.status, 200);
  assert.ok(!list.body.requests.some(entry => entry.id === alicePrf));

  const direct = await call(maya, "GET", `/api/requests/${alicePrf}`);
  assert.equal(direct.status, 404);
});

await check("another requester cannot edit, delete or submit it", async () => {
  assert.equal((await call(maya, "PUT", `/api/requests/${alicePrf}`, { vendor: "Hijack" })).status, 404);
  assert.equal((await call(maya, "DELETE", `/api/requests/${alicePrf}`)).status, 404);
  assert.equal((await call(maya, "POST", `/api/requests/${alicePrf}/submit`, { signature: "Maya" })).status, 404);
});

await check("a requester cannot approve, and cannot reach the export", async () => {
  const decision = await call(maya, "POST", `/api/requests/${alicePrf}/decision`, { action: "approve", signature: "Maya" });
  assert.equal(decision.status, 403);
  assert.equal((await call(alice, "GET", "/api/requests/export")).status, 403);
});

// ---- approval --------------------------------------------------------------------------------------

await check("an approver sees the register but cannot create a request", async () => {
  const list = await call(approver, "GET", "/api/requests");
  assert.equal(list.status, 200);
  assert.ok(list.body.requests.some(entry => entry.id === alicePrf));
  assert.equal((await call(approver, "POST", "/api/requests", { vendor: "X" })).status, 403);
});

await check("an unsubmitted PRF cannot be approved", async () => {
  const response = await call(approver, "POST", `/api/requests/${alicePrf}/decision`, {
    action: "approve",
    signature: "Marcus Lee",
  });
  assert.equal(response.status, 409);
});

await check("the requester submits and signs", async () => {
  const response = await call(alice, "POST", `/api/requests/${alicePrf}/submit`, { signature: "Alice Requester" });
  assert.equal(response.status, 200);
  assert.equal(response.body.request.status, "Awaiting Approval");
  assert.equal(response.body.request.requesterSigned, true);
});

await check("a submitted PRF can no longer be edited or deleted by its requester", async () => {
  assert.equal((await call(alice, "PUT", `/api/requests/${alicePrf}`, { vendor: "Changed" })).status, 409);
  assert.equal((await call(alice, "DELETE", `/api/requests/${alicePrf}`)).status, 409);
});

await check("sending back without a comment is refused", async () => {
  const response = await call(approver, "POST", `/api/requests/${alicePrf}/decision`, { action: "reject", comment: "" });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /comment is required/i);
});

await check("approving records the signature, the approver and the timestamp", async () => {
  const response = await call(approver, "POST", `/api/requests/${alicePrf}/decision`, {
    action: "approve",
    comment: "Coding checks out.",
    signature: "Marcus Lee",
  });
  assert.equal(response.status, 200);
  const record = response.body.request;
  assert.equal(record.status, "Approved");
  assert.equal(record.approverSigned, true);
  assert.ok(record.approvedAt);
  const last = record.audit.at(-1);
  assert.match(last.action, /Approved and electronically signed/);
  assert.equal(last.actorName, "Marcus Lee");
});

await check("an approved PRF is terminal", async () => {
  const response = await call(approver, "POST", `/api/requests/${alicePrf}/decision`, {
    action: "reject",
    comment: "second thoughts",
  });
  assert.equal(response.status, 409);
});

await check("the audit trail records the whole lifecycle in order", async () => {
  const response = await call(approver, "GET", `/api/requests/${alicePrf}`);
  const actions = response.body.request.audit.map(entry => entry.action);
  assert.deepEqual(actions.slice(0, 2), ["Draft created", "Draft saved"]);
  assert.ok(actions.includes("Submitted and electronically signed"));
  assert.ok(actions.includes("Routed for approval"));
  assert.equal(actions.at(-1), "Approved and electronically signed");
});

await check("the export is served to an approver as a CSV attachment", async () => {
  const response = await fetch(`${base}/api/requests/export`, {
    headers: { cookie: [...approver.cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/csv/);
  assert.match(response.headers.get("content-disposition") || "", /attachment/);
  const text = await response.text();
  assert.match(text, /PRF #/);
  assert.match(text, new RegExp(alicePrf));
});

// ---- sign-out --------------------------------------------------------------------------------------

await check("signing out clears the cookie and the old token stops working", async () => {
  const token = alice.cookies.get("prf_session");
  const response = await call(alice, "POST", "/api/auth/logout");
  assert.equal(response.status, 200);
  assert.equal(alice.cookies.get("prf_session"), undefined);

  // Replaying the captured cookie must fail: the session id is revoked, not merely forgotten.
  const replay = await fetch(`${base}/api/requests`, { headers: { cookie: `prf_session=${token}` } });
  assert.equal(replay.status, 401);
});

// ---- report ----------------------------------------------------------------------------------------

await stop();

if (failures.length) {
  console.error(`
  ✗ ${failures.length} of ${passed + failures.length} HTTP checks FAILED
`);
  failures.forEach(entry => console.error(`    ${entry}
`));
  process.exit(1);
}
console.log(`
  ✓ ${passed} HTTP authentication, RBAC and CSRF checks passed
`);
