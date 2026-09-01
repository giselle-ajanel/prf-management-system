# PRF Management System

## Outcome

Replace a fragmented purchase-request process built around forms, email, signatures, and separate records with a secure, searchable workflow application.

## V1 users and workflows

- Employee: sign in, create a PRF, save a draft, reopen/edit, submit, and track status.
- Approver: receive correctly routed requests, review documentation, approve/sign, reject, or return for changes.
- Finance: search all PRFs by spending cycle, monitor manual coding and approval status, inspect the audit trail, and export records.

## Core rules

- Generate identifiers such as `PRF-FY27-0001`.
- Model Funding/Group → Site Code → Site Name → Type → Status → Fiscal Year as controlled master data.
- Permit flagged manual coding where policy allows it.
- Require itemized purchases and automatically calculate totals.
- Flag vague descriptions and require item, purpose, quantity, and intended users.
- Preserve request versions, signatures, attachments, and immutable audit events.
- Re-route material changes for approval.
- Never let AI make or authorize financial decisions.

## Approval thresholds to validate with the business owner

- Up to $5,000: Manager
- $5,001–$15,000: Director
- $15,001–$25,000: Senior Director
- $25,001–$75,000: Chief
- $75,001–$250,000: CFO + CEO
- Over $250,000: CEO

Open decision: determine whether the requester signature is additional to CFO + CEO in the $75,001–$250,000 tier.

## Delivery milestones

1. App shell, authentication placeholder, dashboard, Create PRF, save/reopen draft.
2. Current-form fields, coding master data, line items, totals, and validation.
3. Submission, routing, electronic signatures, returns, rejection, and reapproval.
4. Finance register, spending-cycle reporting, audit history, filters, and exports.

## Portfolio extensions

- Data engineering: ingestion/validation for coding master data, reporting models, and history.
- AI engineering: guarded description-quality checks, policy retrieval, structured coding suggestions, and evaluations.
- Data science/analytics: approval-cycle KPIs, bottleneck analysis, duplicate detection, anomalies, and return-risk analysis.
