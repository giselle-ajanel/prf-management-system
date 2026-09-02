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

| Account | Role |
| --- | --- |
| `giselle.ajanel@woodcraftrangers.org` | Requester |
| `maya.thompson@woodcraftrangers.org` | Requester |
| `marcus.lee@woodcraftrangers.org` | Approver / Finance |

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

Two portals, decided by the account rather than chosen at sign-in:

- **Requester** — create a PRF, save and resume drafts, sign and submit, and track their own requests.
- **Approver / Finance** — work the review queue, approve or send back with a required comment, read the
  audit trail, and export the register.

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
accompanied it, routing, and every approval or return with its comment, actor and timestamp. The store
verifies before each commit that existing entries are still present and unchanged, so a code path that
rewrites history fails instead of succeeding quietly.

A status machine governs the record: `Draft → Awaiting Approval`, `Awaiting Approval → Approved | Returned`,
`Returned → Awaiting Approval`. Nothing returns to `Draft`, and `Approved` is terminal.

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
