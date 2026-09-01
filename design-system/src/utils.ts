// Formatting, validation and routing helpers shared by the components.
//
// Every body here is lifted verbatim from app/page.tsx, including the original comments, which document
// real defects these guards were written to fix. Copying rather than rewriting is deliberate: it makes the
// extraction provably behaviour-preserving.

/** Upper bound applied to any parsed amount, so a pasted or corrupted figure cannot reach totals. */
export const MAX_AMOUNT = 100_000_000;

// Money is only ever derived from user-typed strings, so every amount passes through here first: NaN,
// Infinity and negatives are rejected rather than flowing into totals, approval routing or the PDF.
export const amountOf = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_AMOUNT) : 0;
};

/** True when the raw input parses to a negative number — surfaced as a blocking rule, not silently zeroed. */
export const isNegative = (value: unknown) => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed < 0;
};

/** Parses a countable quantity: whole, positive, and capped. */
export const countOf = (value: unknown) => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 1_000_000) : 0;
};

/** Formats a number as USD. Non-finite input renders as $0.00 rather than "$NaN". */
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(value) ? value : 0);

/** Flags descriptions too thin to justify a purchase — enforced before submission, not before saving. */
export const vague = (text: string) =>
  text.trim().length < 28 || /^(supplies|materials|equipment|services|books|food)$/i.test(text.trim());

/** One rung of the approval ladder: everything up to `max` is signed off by `role`. */
export type ApprovalTier = { max: number; role: string; band: string };

/**
 * The approval ladder, in ascending order.
 *
 * Single source of truth for routing, for the requirements panel on the form, and for the authorisation
 * line on the supervisor's review screen — these used to be three hand-written copies of the same
 * thresholds, which is exactly the kind of thing that drifts apart after one policy change.
 */
export const APPROVAL_TIERS: ApprovalTier[] = [
  { max: 5000, role: "Manager", band: "Up to $5,000" },
  { max: 15000, role: "Director", band: "$5,001–$15,000" },
  { max: 25000, role: "Senior Director", band: "$15,001–$25,000" },
  { max: 75000, role: "Chief", band: "$25,001–$75,000" },
  { max: 250000, role: "CFO + CEO", band: "$75,001–$250,000" },
  { max: Infinity, role: "CEO", band: "Over $250,000" },
];

// A non-finite or non-positive total must never fall through to the cheapest approver (or past every tier).
export const tierFor = (amount: number): ApprovalTier =>
  !Number.isFinite(amount) || amount <= 0
    ? APPROVAL_TIERS[0]
    : APPROVAL_TIERS.find(tier => amount <= tier.max) || APPROVAL_TIERS[APPROVAL_TIERS.length - 1];

/** Who must sign off on this amount. */
export const routeFor = (amount: number) => tierFor(amount).role;

// Sites are keyed on Site Code + Site Name: the workbook reuses codes across different sites (2324 is both
// "Lennox Middle School- LX" and "McKinley ES"), and keying on the code alone dropped one of each pair.
export const siteKeyOf = (siteCode: unknown, siteName: unknown) => {
  const code = String(siteCode ?? "").trim(),
    name = String(siteName ?? "").trim();
  return code || name ? `${code}|${name}` : "";
};

/** Current month as `YYYY-MM`, the key format every month filter compares against. */
export const currentMonth = () => new Date().toISOString().slice(0, 7);

/** Renders a `YYYY-MM` key as "August 2026". Midday avoids the timezone rollback to the previous month. */
export const monthLabel = (value: string) =>
  new Date(`${value}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
