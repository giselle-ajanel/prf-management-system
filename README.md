# Purchase Request Hub

A responsive Next.js/TypeScript purchase-request application with authenticated requester and approver
portals, server-side role enforcement, and an append-only audit trail. The domain model is described by a
PostgreSQL/Prisma schema; the running prototype persists through a file-backed store behind the same
repository interface.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first request seeds three demo accounts with **randomly generated**
passwords, prints them to the server console, and writes them to `.secure-data/seed-credentials.txt`
(git-ignored, mode 600). No password is committed to this repository.

| Account | Role | Signs up to |
| --- | --- | --- |
| `giselle.ajanel@woodcraftrangers.org` | Requester | — |
| `maya.thompson@woodcraftrangers.org` | Requester | — |
| `manager@woodcraftrangers.org` | Approver · Manager | $5,000 |
| `director@woodcraftrangers.org` | Approver · Director | $15,000 |
| `seniordirector@woodcraftrangers.org` | Approver · Senior Director | $25,000 |
| `chief@woodcraftrangers.org` | Approver · Chief | $75,000 |
| `cfo@woodcraftrangers.org` | Approver · CFO | any amount |
| `ceo@woodcraftrangers.org` | Approver · CEO | any amount |
| `finance@woodcraftrangers.org` | Finance Reviewer | — (gate 2) |
| `financeadmin@woodcraftrangers.org` | Finance Administrator | — (administers) |
| `auditor@woodcraftrangers.org` | View Only · Auditor | — (read-only **+ export**) |
| `bookkeeper@woodcraftrangers.org` | View Only · Bookkeeper | — (read-only) |
| `member@woodcraftrangers.org` | View Only · Member | — (read-only) |
| `travelmanager@woodcraftrangers.org` | View Only · Travel Manager | — (read-only) |
| `assistant@woodcraftrangers.org` | View Only · Assistant | — (read-only) |

Addresses stay on `woodcraftrangers.org` because `PRF_ALLOWED_EMAIL_DOMAINS` is configured for it — an
account on another domain would be refused the moment this sits behind SSO.

Delete the store (`.secure-data/prf-store.json`) to start over; the accounts are recreated with new
passwords.

## Tests

```bash
npm test          # everything below
npm run test:ds       # design system: parity, snapshots, options, export/notify, page states
npm run test:server   # authorisation, sessions, input handling (no server needed)
npm run test:http     # the same rules over HTTP, against a dev server on a throwaway store
```

## Authentication

Five roles, decided by the account rather than chosen at sign-in. Capabilities are cumulative — an
Approver and a Finance Reviewer are both requesters who can do more:

- **Requester** — create a PRF, attach documents, save and resume drafts, sign and submit, track their own.
- **Approver** — all of that, plus gate 1: review, comment, return, or sign requests within their tier.
- **Finance Reviewer** — all Requester abilities, plus gate 2: audit coding, funding, receipts and policy
  on requests an approver has already signed.
- **Finance Administrator** — the full submitted register, exports, audit reporting, role assignment.
- **View Only** — read-only visibility across the organisation. Cannot submit, edit, approve or reject.
  Five viewer profiles sit under it — Auditor, Bookkeeper, Member, Travel Manager, Assistant — which differ
  in exactly one respect: **only the Auditor can export.** Reading the register on screen and walking out
  with the organisation's whole spending history are different acts, so the export is the auditor's alone.

Every read-only account is refused with **403** on any state change — creating, editing, deleting,
submitting, either approval gate, and attaching or removing documents. That refusal lives in the data
layer, checked before any question of ownership or status is asked; hiding the buttons is the courtesy on
top of it.

Approvers carry their own signing limit, and authority is checked against the amount rather than against
merely being an approver: a Manager cannot sign off a $50,000 request just because the queue showed it to
them. Sending a request back is open to any approver — spotting a problem does not require the authority to
have approved it. Finance and Administrator sit outside the ladder deliberately: they see the whole register
and assign positions, but cannot authorise spending. Nobody can change their own position, including an
administrator.

Everyone gets a **Profile** view for their name and contact address. The position is shown there but never
editable; it is assigned from the directory, which only Finance and administrators can see.

Sessions are signed, http-only cookies. They end after **one hour of inactivity** and after twelve hours
regardless; both limits are enforced on the server on every request, with the browser's countdown existing
only so an idle signer sees an explanation rather than a failure. Inactivity means the person, not the
application: the editor's periodic autosave marks itself as background when nobody has touched the keyboard
since the last one, so it stores its content without resetting the clock. A PRF left open on an unattended
machine still times out. Signing out revokes the session id
server-side — a copied cookie stops working — and clears every local draft, editor buffer and mirrored copy
this app has written.

In production, identity comes from the SSO reverse proxy documented in `.env.example`; the password form is
refused unless `PRF_ALLOW_PASSWORD_LOGIN=true` is set deliberately. Roles are assigned in the store, never
by a header: an SSO identity nobody has seen before is provisioned as a requester.

## Drafts and what survives a session

An open PRF editor autosaves to the server every 30 seconds, and the whole form is stored — vendor contact
block, per-line expense type, club and split site, and the manual-coding justification, not just the
headline fields. Signing out and the idle timeout both flush the editor first, so the boundary is the last
thing typed rather than the last checkpoint.

The one thing deliberately not restored is the signature. Signing is an act performed at submission, not a
value that should reappear because a draft was reopened.

## Access control

Authorisation lives in `lib/store.ts`, at the data-access layer, and every method takes the actor
performing it. Hiding a button changes nothing about what the API will do:

- A requester sees only their own PRFs. Asking for someone else's by id returns **404, not 403** — the
  existence of the record is itself not theirs to learn.
- **A draft is private to the person writing it.** No position sees another requester's unsubmitted draft —
  not an approver, not Finance, not an administrator. An approver's queue begins when a request is
  submitted. Approvers see everything awaiting review and everything approved, plus the requests they
  personally sent back so a return can be followed to resolution; a return by a different approver belongs
  to that approver. Finance and administrators see every submitted request, because the register and grant
  reporting have to be complete — drafts stay out of that too.
- Drafts are editable by their owner while `Draft` or `Returned`; a submitted or approved PRF is not.
- Only an unsubmitted `Draft` can be deleted. A returned PRF has been submitted once and its history has to
  survive, so it can be fixed and resubmitted but never removed.
- Only approvers decide, and an approver cannot approve a request they submitted. The decision endpoint
  accepts an action, a comment and a signature — there is no parameter through which reviewed line items
  could be edited.
- Sending a request back requires a written comment; approving requires an electronic signature, and a PRF
  the requester never signed cannot be approved at all.
- Creating a PRF is a requester capability. An approver who needs to buy something signs in with their own
  requester account rather than being author and authoriser on one record.

## Attachments and notifications

Supporting documents — receipts, vendor quotes, invoices, W-9s — are attached below the line-item grid by
drag and drop or browsing. Uploads are limited to PDF, PNG and JPG at 10 MB each, and the check that decides
is the file's leading bytes, not its name or the type the browser declared: an executable renamed to
`invoice.pdf` is refused. Files download through a route gated by the same rule that decides who can see the
PRF — its author, anyone with signing authority, and Finance.

A PRF can name a colleague under **Copy**. They have no rights over the request and are notified of its
outcome. Notifications are raised on the server inside the same transaction as the change: a submission
notifies the people whose position could actually authorise that amount, and an approval or send-back
notifies the requester and whoever was copied in.

Site codes beginning `99` are retired and filtered out at the point every dropdown and lookup reads from.

## Request hardening

- **CSRF** — every mutation must echo a token that lives inside the signed session cookie, and any request
  arriving with a foreign `Origin` is refused. Sign-out is the one exception, and says why in the code.
- **Rate limiting** — separate budgets for reads, writes, submissions/decisions, and sign-in attempts. Failed
  sign-ins are throttled per address *and* per account.
- **Input** — every field is read by name and validated server-side against vocabularies the server owns, so
  `status`, `ownerId`, `audit` and `approverSigned` in a request body are simply never looked at. Control
  characters and Unicode bidi overrides are stripped at the boundary; out-of-range values are rejected rather
  than truncated.
- **Responses** — `no-store`, `nosniff`, `same-origin` referrer, `DENY` framing. Internal errors are logged
  server-side and reported as a generic message.

## Audit trail

Every PRF carries an append-only history: creation, each save, submission with the signature that
accompanied it, routing, and every approval or return with its comment, actor and timestamp. Each entry
records both the actor's display name and their immutable user id, so a later rename cannot make an old
approval ambiguous. Account changes — a rename, a contact address, a position reassignment — go to a
separate append-only log readable by Finance and administrators, keyed to the account they were made to and
the person who made them.

Changing your name takes effect immediately: the session cookie is re-issued with it, so the header, the
next approval signature and the Supervisor Approval line on the printed form all show the new name from the
very next request rather than after the next sign-in. A rename never touches the position. The store
verifies before each commit that existing entries are still present and unchanged, so a code path that
rewrites history fails instead of succeeding quietly.

## Two gates

A request passes two independent reviews, in order:

```
Draft ─submit─▶ Pending Supervisor Approval ─sign─▶ Pending Finance Review ─clear─▶ Approved
                          │                                   │
                          └────────── return ─────────────────┴──▶ Needs Revision ─▶ (resubmit)
```

**Gate 1** is authority: does this purchase have a supervisor behind it, at a tier that covers the amount?
**Gate 2** is compliance: do the coding, the funding source, the receipts and the policy hold up? Finance
cannot act on a request still at gate 1 — the endpoint refuses it, and the request is not in their queue at
all, so nobody reviews accounting codes on something that may still be rejected. An approver cannot act
again once they have signed.

`Approved` is terminal and read-only, and it is reachable only through Finance. Nothing returns to `Draft`.
An approver who raises their own request has it escalated past their own tier at submission, and still
cannot approve it.

## Production boundary

The rules above are enforced server-side and covered by tests, but this remains a prototype in two specific
ways. Persistence is a JSON file with an in-process write queue: correct for one Node process, wrong for
several, and the reason `lib/store.ts` is written behind a narrow interface that the Prisma schema in
`prisma/` can implement without any route or component changing. And the deployment concerns around it —
durable file storage, backups, monitoring, encrypted secrets at rest, and a security review — are not
addressed here. Resolve the CFO/CEO signature interpretation documented in `docs/PROJECT_BRIEF.md` before
enabling live routing.

## Protected accounting workbook

`Accounting Codes FY27.xlsx` is stored under `.secure-data/`, which is excluded from Git and is never
exposed through `public/`. Server routes read the workbook and return only options scoped to the
authenticated user's assigned site. In production, configure the variables documented in `.env.example` and
place the application behind organizational SSO that overwrites the trusted identity headers and strips
client-supplied copies.

## Safety

Use fake users and sample PRFs during prototyping. Do not add employee credentials, real purchasing records,
signatures, or confidential attachments to source control.
