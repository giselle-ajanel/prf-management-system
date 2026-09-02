// The shared vocabulary of the Purchase Request Hub design system.
//
// These types are the public contract: they are what the generated .d.ts files expose, so they are written
// out in full rather than in the compressed style used inside app/page.tsx. Behaviour is unchanged — the
// shapes are lifted verbatim from the app's original declarations.

/** Top-level destination in the Hub's primary navigation. */
export type View = "overview" | "requests" | "approvals" | "finance" | "profile";

/** Lifecycle state of a purchase request. Drives StatusPill colour and every queue filter. */
export type Status = "Draft" | "Awaiting Approval" | "Returned" | "Approved";

/** One line on a request: what is being bought, how many, and the unit price. */
export type LineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
};

/** One step in the approval chain. `status` is free text so callers can render custom states. */
export type Approval = {
  role: string;
  name: string;
  status: string;
  time?: string;
};

/** An immutable audit entry. Rendered newest-first in RequestModal's activity record. */
export type AuditEvent = {
  time: string;
  event: string;
  actor: string;
};

/** A purchase request — the central record the whole system is built around. */
export type Request = {
  id: string;
  vendor: string;
  description: string;
  amount: number;
  status: Status;
  district: string;
  school: string;
  siteCode: string;
  fundingCode: string;
  cycle: string;
  requester: string;
  updated: string;
  lineItems: LineItem[];
  approvals: Approval[];
  audit: AuditEvent[];
  documents: string[];
  approvedAt?: string;
  /** ISO timestamp of submission for approval. Distinct from `updated`, which is display text. */
  submittedAt?: string;
  /** How the purchase is paid: `divvy`, `systems` or `direct`. Divvy rows reconcile against the card statement. */
  paymentType?: string;
  /** Dominant expense category across the line items, carried for reporting. */
  expenseType?: string;
  /** Set when the site was typed rather than chosen from the workbook — Finance must assign a real code. */
  customSite?: boolean;
  /** Set when the funding source was typed rather than chosen. */
  customFunding?: boolean;
  /** Reviewer's comment when a request is returned for revision. */
  reviewNote?: string;
  requesterSigned?: boolean;
  approverSigned?: boolean;
  /** Printed name of whoever approved, for the supervisor block on the form and the PDF. */
  approverName?: string;
  /** @deprecated Migrated into `requesterSigned`; retained so stored records still parse. */
  docuSignRequesterSigned?: boolean;
  /** @deprecated Migrated into `approverSigned`; retained so stored records still parse. */
  docuSignApproverSigned?: boolean;
};

/** One row of the FY27 accounting workbook: a site paired with a funding source it may draw on. */
export type AccountingCode = {
  source: string;
  fundingSource: string;
  fundingSourceId: string;
  siteCode: string;
  siteName: string;
  /** Composite `siteCode|siteName` key. Codes are reused across sites, so the code alone is not unique. */
  siteKey: string;
  region: string;
  expenseType: string;
  status: string;
  notes: string;
  availability: "active" | "expiring";
};

/** An option in SearchableCombobox. `search` adds extra terms to match on beyond the visible label. */
export type ComboOption = {
  value: string;
  label: string;
  group?: string;
  search?: string;
  title?: string;
  /** Small badge shown after the label — a period, or a note that the value was entered by hand. */
  tag?: string;
};
