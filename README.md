# Purchase Request Hub

A responsive Next.js/TypeScript purchase-request application derived from the “Greetings and Introduction” conversation. It includes role-aware requester, approver, and Finance experiences plus a PostgreSQL/Prisma domain model.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Implemented experience

- Requester overview and request history
- PRF creation, controlled codes, manual-code justification, and description-quality validation
- Save-draft and submit flows with browser-local persistence
- Amount-based approval routing and approval/return actions
- Detailed request modal with line items, documents, signatures, and audit events
- Finance metrics, global search, six filters, and District → School → PRF drill-down
- Requester/Finance demo-role switcher for testing permissions
- Responsive layouts and keyboard-accessible native form controls
- PostgreSQL/Prisma domain schema for production persistence

## Production boundary

The UI and workflows are build-verified, but the included data is intentionally sample data stored in the browser. Before handling real purchasing records, connect the Prisma schema to PostgreSQL and add organizational SSO, server-side authorization, durable file storage, immutable audit storage, encrypted secrets, backups, monitoring, and security/compliance review. Resolve the CFO/CEO signature interpretation documented in `docs/PROJECT_BRIEF.md` before enabling live routing.

## Protected accounting workbook

`Accounting Codes FY27.xlsx` is stored under `.secure-data/`, which is excluded from Git and is never exposed through `public/`. Server routes read the workbook and return only options scoped to the authenticated user's assigned site. In production, configure the variables documented in `.env.example` and place the application behind organizational SSO that overwrites the trusted identity headers and strips client-supplied copies.

The demo identity fallback works only in development. Production accounting routes reject requests without an approved organizational email domain. PRFs are created, signed, submitted, and approved in the native application editor.

## Safety

Use fake users and sample PRFs during prototyping. Do not add employee credentials, real purchasing records, signatures, or confidential attachments to source control.
