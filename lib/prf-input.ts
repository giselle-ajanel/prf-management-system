import "server-only";
import { count, email as emailAddress, line, list, money, oneOf, optionalOneOf, optionalText } from "./sanitize";
import type { DraftInput, StoredLine } from "./store";

// Parses an untrusted request body into the exact shape the store accepts.
//
// Two properties matter here. Every field is read by name, so anything else in the JSON — status, ownerId,
// audit, approverSigned — is simply never looked at and cannot ride along into the record. And the
// controlled vocabularies (payment type, expense type) are defined server-side rather than validated
// against a list the client sent.
//
// The vocabularies duplicate the design system's DEFAULT_PAYMENT_TYPES and DEFAULT_EXPENSE_TYPES, because
// server code cannot import the client component barrel. test/authz.mjs asserts the two stay identical, so
// adding an expense type in one place and not the other fails the suite rather than the user's submission.

export const PAYMENT_TYPES = ["divvy", "systems", "direct"] as const;

export const EXPENSE_TYPES = [
  "Program Supplies",
  "Program Events",
  "Transportation",
  "Conferences & Training",
  "Outside Services",
  "Lunch & Meeting",
  "Auto - Mileage",
  "Other",
] as const;

const MAX_LINES = 40;
const MAX_DOCUMENTS = 20;

export function parseDraft(body: unknown): DraftInput {
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const lineItems: StoredLine[] = list(payload.lineItems ?? [], "Line items", MAX_LINES, (entry, index) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    return {
      description: line(item.description, `Line ${index + 1} description`, 300),
      quantity: count(item.quantity ?? 1, `Line ${index + 1} quantity`),
      unitPrice: money(item.unitPrice ?? 0, `Line ${index + 1} amount`),
      expenseType: optionalOneOf(item.expenseType, `Line ${index + 1} expense type`, EXPENSE_TYPES),
      club: line(item.club, `Line ${index + 1} club`, 80, false),
      splitSite: line(item.splitSite, `Line ${index + 1} site`, 80, false),
    };
  });

  return {
    // A draft is allowed to be incomplete — that is what a draft is — so the identifying fields are
    // optional here and required at submission instead, where the record becomes something an approver
    // is asked to authorise.
    vendor: line(payload.vendor, "Vendor", 200, false),
    vendorAddress: line(payload.vendorAddress, "Vendor address", 200, false),
    vendorCity: line(payload.vendorCity, "Vendor city, state, zip", 160, false),
    // Validated only when present: a draft may not have reached this field yet, but a malformed address
    // should be corrected while the requester is still looking at the form.
    vendorEmail: payload.vendorEmail ? emailAddress(payload.vendorEmail, "Vendor email") : "",
    // The colleague copied in for visibility. Both halves are optional, but an address that is present
    // has to be a real one — a typo here means someone silently never hears about the request.
    copyName: line(payload.copyName, "Copy name", 120, false),
    copyEmail: payload.copyEmail ? emailAddress(payload.copyEmail, "Copy email") : "",
    description: optionalText(payload.description, "Description", 2000),
    justification: optionalText(payload.justification, "Justification", 2000),
    district: line(payload.district, "District", 120, false),
    school: line(payload.school, "Site", 200, false),
    siteCode: line(payload.siteCode, "Site code", 40, false),
    fundingCode: line(payload.fundingCode, "Funding source", 160, false),
    paymentType: optionalOneOf(payload.paymentType, "Payment type", PAYMENT_TYPES),
    expenseType: optionalOneOf(payload.expenseType, "Expense type", EXPENSE_TYPES),
    customSite: payload.customSite === true,
    customFunding: payload.customFunding === true,
    lineItems,
    // Undefined rather than [] when the client says nothing about documents: the store reads that as
    // "leave them alone", so an editor save cannot silently detach a vendor quote.
    documents:
      payload.documents === undefined
        ? undefined
        : list(payload.documents, "Documents", MAX_DOCUMENTS, (entry, index) => line(entry, `Document ${index + 1}`, 260)),
  };
}

// The completeness rules for submission live in store.submitRequest, next to the transition they guard,
// rather than here: they have to hold for the stored record, not merely for the body of whichever request
// happened to submit it.

export const decisionAction = (value: unknown) => oneOf(value, "Action", ["approve", "reject"] as const);
