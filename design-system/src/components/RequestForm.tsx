"use client";

import { Fragment, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AccountingCode, ComboOption } from "../types";
import { amountOf, isNegative, money, siteKeyOf, vague } from "../utils";
import { buildFundingOptions, fundingChoicesFor } from "../funding";
import { RuleBanner } from "./RuleBanner";
import { SearchableCombobox } from "./SearchableCombobox";
import { SignatureField, type SignatureMode } from "./SignatureField";
import { AttachmentZone, type AttachmentSummary } from "./AttachmentZone";

/**
 * One editable line in the PRF table. Every field is a string — this is raw form state, not parsed data.
 *
 * There is deliberately no `quantity` field. The paper form has a single "Item Description and Quantity"
 * cell, and the digital form now matches it: requesters write what, how many, and why in one block. Records
 * saved before this change may still carry a `quantity` string; it is ignored on read.
 */
export type PrfLineDraft = {
  description: string;
  expenseType: string;
  club: string;
  splitSite: string;
  amount: string;
};

/** The complete editor state for one purchase request. */
export type PrfFormState = {
  vendor: string;
  vendorAddress: string;
  vendorCity: string;
  vendorEmail: string;
  /** Colleague copied in for visibility on this request. */
  copyName: string;
  copyEmail: string;
  description: string;
  amount: string;
  district: string;
  school: string;
  siteKey: string;
  siteName: string;
  siteCode: string;
  fundingCode: string;
  region: string;
  expenseType: string;
  paymentType: string;
  lineItems: PrfLineDraft[];
  requestorName: string;
  requestorSignature: string;
  signatureMode: string;
  requestorDate: string;
  supervisorName: string;
  supervisorSignature: string;
  supervisorDate: string;
  manualSite: string;
  manualFunding: string;
  justification: string;
  /**
   * True when the site was typed rather than chosen from the accounting workbook.
   *
   * Carried onto the saved request and into the audit trail so Finance can find new partnerships that
   * still need a real site code issued.
   */
  customSite?: boolean;
  /** True when the funding source was typed rather than chosen. */
  customFunding?: boolean;
};

/** What a rule sees when deciding whether it applies. */
export type PrfRuleContext = {
  form: PrfFormState;
  /** Resolved site name — from the matched accounting row, falling back to the form's school. */
  siteName: string;
  lineItems: PrfLineDraft[];
};

/**
 * A policy check surfaced as a banner above the signature block.
 *
 * `blocked` rules also disable submission; `info` rules are advisory. Rules render in array order.
 */
export type PrfRule = {
  id: string;
  tone: "info" | "blocked";
  title: string;
  message: string;
  applies: (context: PrfRuleContext) => boolean;
};

/**
 * The two purchasing rules the Hub shipped with.
 *
 * These encode one organisation's funding policy, so they are data rather than logic — pass your own
 * `rules` to replace them. They are the default only so that existing call sites behave identically.
 */
export const DEFAULT_PRF_RULES: PrfRule[] = [
  {
    id: "pasadena-contract",
    tone: "info",
    title: "Contract duration",
    message: "Pasadena site contract is for 6 weeks only (11/03 – 12/18).",
    applies: ({ siteName }) => /Field ES - Pasadena/i.test(siteName),
  },
  {
    id: "asset-transportation",
    tone: "blocked",
    title: "Funding restriction",
    message: "We cannot use ASSET funding for transportation.",
    applies: ({ form, lineItems, siteName }) =>
      /asset/i.test(form.fundingCode) &&
      lineItems.some(line => line.expenseType === "Transportation") &&
      /Huntington Park High School|Manual Arts High School|South East High School|West Adams/i.test(siteName),
  },
];

/** Workbook tab holding department / overhead rows. */
export const DEPARTMENT_TAB = "FY27";
/** Workbook tab holding school-site rows. */
export const SCHOOL_TAB = "School Site Codes FY27";
/** Group heading for departments in the site combobox. */
export const DEPARTMENT_GROUP = "--- DEPARTMENTS / OVERHEAD ---";
/** Group heading for schools in the site combobox. */
export const SCHOOL_GROUP = "--- SCHOOL SITES ---";
/** Group heading for grant- and programme-funded entries. */
export const GRANT_GROUP = "--- GRANTS & PROGRAMS ---";
/** Group heading for rows Finance added ahead of the master workbook. */
export const OVERRIDE_GROUP = "--- ADDED BY FINANCE ---";
/** Group heading for anything from a source with no explicit mapping. */
export const OTHER_GROUP = "--- OTHER SITES ---";

/**
 * Maps an accounting row's `source` tab to the heading it appears under.
 *
 * Sources with no entry fall back to {@link OTHER_GROUP} rather than vanishing — an earlier version built
 * the list from two named tabs only, which silently hid every grant and department row.
 */
export const DEFAULT_SITE_GROUPS: Record<string, string> = {
  [DEPARTMENT_TAB]: DEPARTMENT_GROUP,
  "Dept Codes": DEPARTMENT_GROUP,
  [SCHOOL_TAB]: SCHOOL_GROUP,
  Grants: GRANT_GROUP,
  "Finance overrides": OVERRIDE_GROUP,
};

/** Order the groups appear in. Anything unlisted sorts to the end. */
export const SITE_GROUP_ORDER = [DEPARTMENT_GROUP, SCHOOL_GROUP, GRANT_GROUP, OVERRIDE_GROUP, OTHER_GROUP];

/** Payment methods offered by the radio group. */
export const DEFAULT_PAYMENT_TYPES: [string, string][] = [
  ["divvy", "Divvy Card"],
  ["systems", "Systems Dept"],
  ["direct", "Direct Vendor (Check Request or ePay)"],
];

/** Expense categories offered per line. */
export const DEFAULT_EXPENSE_TYPES = [
  "Program Supplies",
  "Program Events",
  "Transportation",
  "Conferences & Training",
  "Outside Services",
  "Lunch & Meeting",
  "Auto - Mileage",
  "Other",
];

/**
 * Turns the accounting rows for one site into a single combobox option.
 *
 * `rows` is every row sharing a site key, because a site usually has several funding sources and the
 * search text has to cover all of them — de-duplicating to one row made a site findable by whichever
 * funding source happened to be last, and invisible under the others.
 */
export const toSiteOption = (rows: AccountingCode[], group: string): ComboOption => {
  // Prefer a row that carries a numeric code as the representative; grants rows have none.
  const site = rows.find(row => row.siteCode) || rows[0];
  const fundingSources = [...new Set(rows.map(row => row.fundingSource).filter(Boolean))];
  const regions = [...new Set(rows.map(row => row.region).filter(Boolean))];
  const notes = [...new Set(rows.map(row => row.notes).filter(Boolean))];
  return {
    value: site.siteKey,
    label: site.siteCode ? `${site.siteName} (${site.siteCode})` : site.siteName,
    group,
    search: [site.siteName, site.siteCode, ...fundingSources, ...regions].filter(Boolean).join(" "),
    title: notes.length ? notes.join(" · ") : undefined,
  };
};

/**
 * Builds the grouped site list for the PRF editor.
 *
 * Every accounting row reaches the dropdown: rows are de-duplicated by site key, bucketed by whatever
 * their `source` maps to, and sorted by name within each bucket. A source with no mapping lands under
 * {@link OTHER_GROUP} rather than disappearing — an earlier version built the list from two named tabs,
 * which silently hid every grant and department row once the workbook reader was widened.
 *
 * Exported so the grouping can be tested directly: the menu is only rendered while the combobox is open,
 * so it never appears in a server-rendered snapshot.
 */
export function buildSiteOptions(
  accounting: AccountingCode[],
  siteGroups: Record<string, string> = DEFAULT_SITE_GROUPS,
  groupOrder: string[] = SITE_GROUP_ORDER,
): ComboOption[] {
  // Collect every row per site, preserving workbook order so the first source seen decides the group.
  const bySite = new Map<string, AccountingCode[]>();
  for (const row of accounting) {
    const rows = bySite.get(row.siteKey);
    if (rows) rows.push(row);
    else bySite.set(row.siteKey, [row]);
  }
  const grouped = new Map<string, AccountingCode[][]>();
  for (const rows of bySite.values()) {
    const group = siteGroups[rows[0].source] || OTHER_GROUP;
    const bucket = grouped.get(group);
    if (bucket) bucket.push(rows);
    else grouped.set(group, [rows]);
  }
  const ordered = [...grouped.keys()].sort((a, b) => {
    const ai = groupOrder.indexOf(a), bi = groupOrder.indexOf(b);
    return (ai < 0 ? groupOrder.length : ai) - (bi < 0 ? groupOrder.length : bi) || a.localeCompare(b);
  });
  return [
    { value: "", label: "-- select --" },
    ...ordered.flatMap(group =>
      grouped
        .get(group)!
        .sort((a, b) => a[0].siteName.localeCompare(b[0].siteName))
        .map(rows => toSiteOption(rows, group)),
    ),
  ];
}

/** Colour and icon treatment for the status line above the footer. */
export type NoticeTone = "success" | "problem";

export type RequestFormProps = {
  form: PrfFormState;
  setForm: (form: PrfFormState) => void;
  /** Validation or status message shown just above the footer actions. */
  notice: string;
  /**
   * How that message reads. A saved draft is good news and must not borrow the colours of a failure —
   * the red "Open Draft saved" banner had people re-saving because they thought something went wrong.
   */
  noticeTone?: NoticeTone;
  /** Rows from the accounting workbook, used to populate the site and funding comboboxes. */
  accounting: AccountingCode[];
  /** Loading/among-sites status line beneath the accounting block. */
  accountingStatus: string;
  /** Auto-save indicator text, e.g. "Saved 9:06 AM". */
  lastSaved: string;
  /** Whether there are unsaved edits. Switches the save-state indicator. */
  dirty: boolean;
  onClose: () => void;
  onSave: (submit: boolean) => unknown;
  onProceed: () => void;
  /** Deletes the draft being edited. Omit for a PRF that has never been saved — there is nothing to delete. */
  onDelete?: () => void;
  /** Files already attached to this request. */
  attachments?: AttachmentSummary[];
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  /** False until the draft exists on the server and a file has somewhere to go. */
  attachmentsEnabled?: boolean;
  attachmentError?: string;
  attachmentBusy?: boolean;
  /** Builds the link for opening or downloading one attached document. */
  attachmentHref?: (attachment: { id: string; name: string; size: number; type: string }) => string;
  /** Upload ceiling in bytes, passed through to the zone. */
  maxUploadBytes?: number;
  /** Policy banners. Defaults to {@link DEFAULT_PRF_RULES}. */
  rules?: PrfRule[];
  /** Maps an accounting row's `source` to its group heading. Defaults to {@link DEFAULT_SITE_GROUPS}. */
  siteGroups?: Record<string, string>;
  /** Order the group headings appear in. Defaults to {@link SITE_GROUP_ORDER}. */
  groupOrder?: string[];
  paymentTypes?: [string, string][];
  expenseTypes?: string[];
  /** Brand lines in the printed form header, one per line. */
  brandLines?: string[];
  /** Dialog title. */
  title?: string;
  /** Signature-requirement lines in the requirements panel. */
  requirements?: string[];
};

/**
 * The native PRF editor: a full-screen dialog reproducing the paper purchase request form.
 *
 * Selecting a site fills the funding source from that exact workbook row, and restricts the funding
 * dropdown to the sources that site can draw on. Line amounts roll up into the grand total and the
 * request description automatically. Submission is gated on site, funding, payment type, vendor, a
 * positive total, no negative lines, a specific-enough description, a full signature block, and no
 * `blocked` rule being active.
 *
 * ```tsx
 * <RequestForm
 *   form={form}
 *   setForm={setForm}
 *   notice={notice}
 *   accounting={accounting}
 *   accountingStatus={accountingStatus}
 *   lastSaved={lastSaved}
 *   dirty={dirty}
 *   onClose={closeEditor}
 *   onSave={saveNativeDraft}
 *   onProceed={submitNative}
 * />
 * ```
 */
export function RequestForm({
  form,
  setForm,
  notice,
  noticeTone = "problem",
  accounting,
  accountingStatus,
  lastSaved,
  dirty,
  onClose,
  onSave,
  onProceed,
  onDelete,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  attachmentsEnabled = false,
  attachmentError = "",
  attachmentBusy = false,
  attachmentHref,
  maxUploadBytes,
  rules = DEFAULT_PRF_RULES,
  siteGroups = DEFAULT_SITE_GROUPS,
  groupOrder = SITE_GROUP_ORDER,
  paymentTypes = DEFAULT_PAYMENT_TYPES,
  expenseTypes = DEFAULT_EXPENSE_TYPES,
  brandLines = ["WOODCRAFT", "RANGERS"],
  title = "Woodcraft Rangers Purchase Request Form",
  requirements = [
    "All PRFs require 2 signatures",
    "Up to $5,000: Manager · $5,001–$15,000: Director",
    "$15,001–$25,000: Senior Director · $25,001–$75,000: Chief",
    "$75,001–$250,000: CFO + CEO · Over $250,000: CEO",
  ],
}: RequestFormProps) {
  // Sites are keyed on Site Code + Site Name: the workbook reuses codes across different sites (2324 is both
  // "Lennox Middle School- LX" and "McKinley ES"), and keying on the code alone dropped one of each pair.
  const siteKey = form.siteKey || siteKeyOf(form.siteCode, form.school);
  const siteOptions = buildSiteOptions(accounting, siteGroups, groupOrder);
  const siteRows = accounting.filter(option => option.siteKey === siteKey);
  // Each of the site's funding sources is offered in every period it can be drawn in.
  const fundingOptions = buildFundingOptions(siteRows, form.fundingCode);
  const expenseOptions: ComboOption[] = expenseTypes.map(value => ({ value, label: value }));
  const update = (values: Partial<PrfFormState>) => setForm({ ...form, ...values });
  // Selecting a site instantly fills Funding Source from that exact workbook row; when the site carries more
  // than one funding source the dropdown is restricted to just those rows and the first is pre-filled.
  const selectSite = (nextKey: string) => {
    const choices = accounting.filter(option => option.siteKey === nextKey),
      site = choices[0];
    // Pre-fill funding with the site's first available choice, which after expansion is a period variant.
    const [firstChoice] = fundingChoicesFor(choices);
    update({
      siteKey: nextKey,
      siteCode: site?.siteCode || "",
      siteName: site?.siteName || "",
      school: site?.siteName || "",
      fundingCode: firstChoice?.value || "",
      region: site?.region || "",
      customSite: false,
      customFunding: false,
    });
  };

  /**
   * Records a site the requester typed because it is not in the workbook yet.
   *
   * There is no site code to assign — Finance issues those — so the entry is flagged instead, and the
   * funding field is unlocked for free text since a site the workbook has never seen has no funding rows.
   */
  const enterCustomSite = (name: string) => {
    const typed = name.trim();
    if (!typed) return;
    update({
      siteKey: siteKeyOf("", typed),
      siteCode: "",
      siteName: typed,
      school: typed,
      fundingCode: "",
      region: "",
      customSite: true,
      customFunding: false,
    });
  };

  const enterCustomFunding = (name: string) => {
    const typed = name.trim();
    if (typed) update({ fundingCode: typed, customFunding: true });
  };
  const updateLine = (index: number, key: string, value: string) => {
    const lineItems = form.lineItems.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
      amount = lineItems.reduce((sum, line) => sum + amountOf(line.amount), 0),
      description = lineItems
        .map(line => line.description)
        .filter(Boolean)
        .join("; ");
    setForm({
      ...form,
      lineItems,
      amount: String(amount),
      description,
      expenseType: lineItems.find(line => line.description)?.expenseType || "Program Supplies",
    });
  };
  // Only amounts can be negative now that quantity has moved into the description block.
  const negativeLines = form.lineItems.some(line => isNegative(line.amount));
  const selected = siteRows.find(option => option.fundingSource === form.fundingCode) || siteRows[0],
    siteName = selected?.siteName || form.school || "";
  const active = rules.filter(rule => rule.applies({ form, siteName, lineItems: form.lineItems }));
  const blocked = active.some(rule => rule.tone === "blocked");
  /**
   * Everything that has to be true before a PRF can be submitted, and the sentence to show when it is not.
   *
   * This used to be one boolean that disabled the submit button. A disabled button is the worst of both
   * worlds: it refuses to work and refuses to say why, and people conclude the form is broken. The rules
   * are unchanged — they are just answerable now, field by field.
   */
  const findProblems = (): Record<string, string> => {
    const problems: Record<string, string> = {};
    // A custom site has no code yet, so the site name stands in for it.
    if (!form.siteCode && !(form.customSite && form.siteName)) problems.site = "Choose a site or department before submitting.";
    if (!form.fundingCode) problems.funding = "Choose the funding source this purchase draws on.";
    if (!form.paymentType) problems.payment = "Select how this purchase will be paid.";
    if (!form.vendor.trim()) problems.vendor = "Enter the vendor, payee, or cardholder.";
    if (!form.lineItems.some(line => line.description.trim())) {
      problems.lines = "Add at least one item, including how many and who it is for.";
    } else if (vague(form.description)) {
      problems.lines = "Say what the items are, how many, and their educational purpose.";
    }
    if (negativeLines) problems.lines = "Line amounts cannot be negative.";
    if (amountOf(form.amount) <= 0) problems.amount = "Enter an amount for at least one line.";
    if (!form.requestorName.trim()) problems.requestorName = "Print your name.";
    if (!form.requestorSignature) problems.signature = "Sign before submitting.";
    if (!form.requestorDate) problems.requestorDate = "Add the date.";
    // A malformed copy address means someone silently never hears about the request.
    if (form.copyEmail.trim() && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(form.copyEmail.trim())) {
      problems.copyEmail = "Enter a valid email address, or leave Copy blank.";
    }
    if (blocked) problems.rules = "Resolve the highlighted policy issue above before submitting.";
    return problems;
  };

  const [problems, setProblems] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const submit = () => {
    const found = findProblems();
    setProblems(found);
    if (!Object.keys(found).length) {
      setAlert("");
      onProceed();
      return;
    }
    setAlert("Please complete all highlighted required fields before submitting.");
    // Scroll to the first thing that needs attention rather than leaving people hunting for the red.
    window.requestAnimationFrame(() => {
      const first = formRef.current?.querySelector<HTMLElement>("[data-invalid='true']");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.querySelector<HTMLElement>("input, textarea, select, button")?.focus({ preventScroll: true });
    });
  };

  /** Attributes that mark a field group as invalid, for both the stylesheet and assistive technology. */
  const flag = (field: string) =>
    problems[field] ? { "data-invalid": "true" as const, "aria-invalid": true as const } : {};

  const message = (field: string) =>
    problems[field] ? <p className="fieldError">{problems[field]}</p> : null;

  return (
    <div className="modalBackdrop prfEditorBackdrop">
      <section className="prfEditor" role="dialog" aria-modal="true" aria-labelledby="new-title">
        <header className="editorTopbar">
          <div>
            <p className="eyebrow">NATIVE DIGITAL FORM</p>
            <h2 id="new-title">{title}</h2>
          </div>
          <div className="saveState">
            <span>{dirty ? "○ Unsaved changes" : `● ${lastSaved || "Auto-save ready"}`}</span>
            <small>
              {dirty ? "Closing will offer to save this as an Open Draft" : "Saved every 30 seconds as an Open Draft"}
            </small>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <form
          ref={formRef}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            submit();
          }}
          className="prfPaper"
          noValidate
        >
          {alert && (
            <div className="submitAlert" role="alert">
              <strong>{alert}</strong>
              <span>{Object.keys(problems).length} field{Object.keys(problems).length === 1 ? "" : "s"} need attention.</span>
            </div>
          )}
          <section className="prfHeader">
            <div className="prfBrand">
              {/* Fragments, not wrapper elements: the original markup is bare text separated by <br/>,
                  and .prfBrand strong styles those text nodes directly. */}
              <strong>
                {brandLines.map((line, index) => (
                  <Fragment key={line}>
                    {index > 0 && <br />}
                    {line}
                  </Fragment>
                ))}
              </strong>
              <span>PURCHASE REQUEST FORM</span>
            </div>
            <div className="prfRequirements">
              <strong>REQUIREMENTS:</strong>
              <small>
                {requirements.map((line, index) => (
                  <Fragment key={line}>
                    {index > 0 && <br />}
                    {line}
                  </Fragment>
                ))}
              </small>
            </div>
          </section>
          <section className="prfAccounting">
            <div className="fieldGroup" {...flag("site")}>
            <SearchableCombobox
              label="SITE"
              value={siteKey}
              options={siteOptions}
              onChange={selectSite}
              allowCustom
              customLabel="+ Enter Custom / Unlisted Site"
              onCustom={enterCustomSite}
              isCustom={Boolean(form.customSite)}
              customTag="custom site"
              placeholder="Search all sites by name or code, or type an unlisted one…"
            />
            {message("site")}
            </div>
            <div className="fieldGroup" {...flag("funding")}>
            <SearchableCombobox
              label="FUNDING SOURCE"
              value={form.fundingCode}
              options={fundingOptions}
              onChange={value => update({ fundingCode: value, customFunding: false })}
              // A custom site has no workbook funding rows, so the field is unlocked for free text.
              allowCustom
              customLabel="+ Enter Custom / Unlisted Funding Source"
              onCustom={enterCustomFunding}
              isCustom={Boolean(form.customFunding)}
              customTag="custom funding"
              disabled={!siteKey && !form.customSite}
              placeholder={
                form.customSite
                  ? "Type the funding source for this new partnership…"
                  : siteKey
                    ? "Search funding source…"
                    : "Select a site first"
              }
            />
            <small>{accountingStatus}</small>
            {message("funding")}
            </div>
            {form.customSite && (
              <RuleBanner
                tone="info"
                title="Unlisted site"
                message={`"${form.siteName}" is not in the FY27 workbook. It will be flagged for Finance to review and assign a site code before this PRF can be coded.`}
              />
            )}
          </section>
          <fieldset className="paymentTypes" {...flag("payment")}>
            <legend>PAYMENT TYPE — SELECT ONE</legend>
            {paymentTypes.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="paymentType"
                  value={value}
                  checked={form.paymentType === value}
                  onChange={event => update({ paymentType: event.target.value })}
                />
                {label}
              </label>
            ))}
            {message("payment")}
          </fieldset>
          <section className="vendorBlock">
            <h3>Vendor*/Payee/Cardholder:</h3>
            <label {...flag("vendor")}>
              Name:
              <input value={form.vendor} onChange={event => update({ vendor: event.target.value })} />
              {message("vendor")}
            </label>
            <label>
              Address:
              <input value={form.vendorAddress} onChange={event => update({ vendorAddress: event.target.value })} />
            </label>
            <label>
              City, State, Zip:
              <input value={form.vendorCity} onChange={event => update({ vendorCity: event.target.value })} />
            </label>
            <label>
              Email:
              <input type="email" value={form.vendorEmail} onChange={event => update({ vendorEmail: event.target.value })} />
            </label>
          </section>
          {/* Copy: a site lead or coordinator who should see what happens to this request without having
              any say over it. They are notified of the outcome, and that is the whole of their part. */}
          <section className="copyBlock">
            <h3>Copy:</h3>
            <label>
              Name:
              <input
                value={form.copyName}
                onChange={event => update({ copyName: event.target.value })}
                placeholder="Site lead or coordinator"
              />
            </label>
            <label {...flag("copyEmail")}>
              Email:
              <input
                type="email"
                value={form.copyEmail}
                onChange={event => update({ copyEmail: event.target.value })}
                placeholder="name@woodcraftrangers.org"
              />
            </label>
            {message("copyEmail")}
            <small>Copied colleagues are notified when this request is approved or sent back.</small>
          </section>
          <div className="lineTableWrap" {...flag("lines")}>
            <table className="nativeLineTable">
              <thead>
                <tr>
                  <th>
                    Item Description and Quantity
                    <small>Be specific: what, how many, and for what purpose</small>
                  </th>
                  <th>Expense Type</th>
                  <th>Club</th>
                  <th>
                    Site/Dept #<small>If split</small>
                  </th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {form.lineItems.map((line, index) => (
                  <tr key={index}>
                    <td>
                      <div className="descriptionQty">
                        <textarea
                          aria-label={`Item ${index + 1} description and quantity`}
                          placeholder={index === 0 ? "e.g. 24 classroom robotics kits for the Grade 9 STEM lab" : ""}
                          value={line.description}
                          onChange={event => updateLine(index, "description", event.target.value)}
                        />
                      </div>
                    </td>
                    <td>
                      <SearchableCombobox
                        label=""
                        value={line.expenseType}
                        options={expenseOptions}
                        onChange={value => updateLine(index, "expenseType", value)}
                      />
                    </td>
                    <td>
                      <input value={line.club} onChange={event => updateLine(index, "club", event.target.value)} />
                    </td>
                    <td>
                      <input value={line.splitSite} onChange={event => updateLine(index, "splitSite", event.target.value)} />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.amount}
                        onChange={event => updateLine(index, "amount", event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>GRAND TOTAL:</td>
                  <td>{money(Number(form.amount) || 0)}</td>
                </tr>
              </tfoot>
            </table>
            {message("lines")}
            {message("amount")}
          </div>
          <AttachmentZone
            attachments={attachments}
            onAdd={files => onAttach?.(files)}
            onRemove={id => onRemoveAttachment?.(id)}
            hrefFor={attachmentHref}
            {...(maxUploadBytes ? { maxBytes: maxUploadBytes } : {})}
            enabled={attachmentsEnabled && Boolean(onAttach)}
            error={attachmentError}
            busy={attachmentBusy}
          />
          {active.map(rule => (
            <RuleBanner key={rule.id} tone={rule.tone} title={rule.title} message={rule.message} />
          ))}
          {negativeLines && (
            <RuleBanner
              tone="blocked"
              title="Invalid amount"
              message="Line item amounts must be zero or greater. Negative values are not accepted on a purchase request."
            />
          )}
          <section className="signatureGrid">
            <div>
              <label {...flag("requestorName")}>
                Requestor Print Name
                <input value={form.requestorName} onChange={event => update({ requestorName: event.target.value })} />
                {message("requestorName")}
              </label>
              <div className="fieldGroup" {...flag("signature")}>
                <SignatureField
                  value={form.requestorSignature}
                  mode={form.signatureMode as SignatureMode}
                  onMode={value => update({ signatureMode: value, requestorSignature: "" })}
                  onChange={value => update({ requestorSignature: value })}
                />
                {message("signature")}
              </div>
              <label {...flag("requestorDate")}>
                Date
                <input
                  type="date"
                  value={form.requestorDate}
                  onChange={event => update({ requestorDate: event.target.value })}
                />
                {message("requestorDate")}
              </label>
            </div>
            <div className="supervisorBlock">
              <label>
                Supervisor Approval
                <input value={form.supervisorName} readOnly placeholder="Completed during approval" />
              </label>
              <label>
                Supervisor Signature
                <input value={form.supervisorSignature} readOnly placeholder="Pending" />
              </label>
              <label>
                Date
                <input type="date" value={form.supervisorDate} readOnly />
              </label>
            </div>
          </section>
          {notice && (
            <div className={`formNotice ${noticeTone === "success" ? "isSuccess" : "isProblem"}`}>
              {noticeTone === "success" && <span aria-hidden="true">✓</span>}
              {notice}
            </div>
          )}
          <footer className="editorActions">
            {/* Destructive action sits at the far left, apart from the two forward actions, so it is never
                the button someone reaches for on the way to submitting. */}
            {onDelete && (
              <button type="button" className="deleteDraft" onClick={onDelete}>
                Delete Draft
              </button>
            )}
            <button type="button" className="secondary" onClick={() => onSave(false)}>
              Save Open Draft
            </button>
            <button type="submit">Sign &amp; Submit for Approval</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
