"use client";

import { Fragment } from "react";
import type { FormEvent } from "react";
import type { AccountingCode, ComboOption } from "../types";
import { amountOf, isNegative, money, siteKeyOf, vague } from "../utils";
import { RuleBanner } from "./RuleBanner";
import { SearchableCombobox } from "./SearchableCombobox";
import { SignatureField, type SignatureMode } from "./SignatureField";

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

export type RequestFormProps = {
  form: PrfFormState;
  setForm: (form: PrfFormState) => void;
  /** Validation or status message shown just above the footer actions. */
  notice: string;
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
  /** Policy banners. Defaults to {@link DEFAULT_PRF_RULES}. */
  rules?: PrfRule[];
  /** Workbook tab identifying department/overhead rows. */
  departmentTab?: string;
  /** Workbook tab identifying school-site rows. */
  schoolTab?: string;
  /** Group heading for departments in the site combobox. */
  departmentGroup?: string;
  /** Group heading for schools in the site combobox. */
  schoolGroup?: string;
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
  accounting,
  accountingStatus,
  lastSaved,
  dirty,
  onClose,
  onSave,
  onProceed,
  rules = DEFAULT_PRF_RULES,
  departmentTab = DEPARTMENT_TAB,
  schoolTab = SCHOOL_TAB,
  departmentGroup = DEPARTMENT_GROUP,
  schoolGroup = SCHOOL_GROUP,
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
  const toSiteOption = (site: AccountingCode, group: string): ComboOption => ({
    value: site.siteKey,
    label: `${site.siteName} (${site.siteCode})`,
    group,
    search: `${site.siteName} ${site.siteCode} ${site.fundingSource} ${site.region}`,
    title: site.notes || undefined,
  });
  const uniqueSites = (tab: string) =>
    [...new Map(accounting.filter(option => option.source === tab).map(option => [option.siteKey, option])).values()].sort(
      (a, b) => a.siteName.localeCompare(b.siteName),
    );
  const departments = uniqueSites(departmentTab),
    schools = uniqueSites(schoolTab);
  const siteOptions: ComboOption[] = [
    { value: "", label: "-- select --" },
    ...departments.map(site => toSiteOption(site, departmentGroup)),
    ...schools.map(site => toSiteOption(site, schoolGroup)),
  ];
  const siteRows = accounting.filter(option => option.siteKey === siteKey);
  const fundingRows = [...new Map(siteRows.map(option => [option.fundingSource, option])).values()].filter(
      row => row.fundingSource,
    ),
    fundingOptions: ComboOption[] = [
      { value: "", label: "-- select --" },
      ...fundingRows.map(row => ({
        value: row.fundingSource,
        label: row.fundingSource,
        search: `${row.fundingSource} ${row.siteName} ${row.siteCode}`,
        title: row.notes || undefined,
      })),
    ];
  const expenseOptions: ComboOption[] = expenseTypes.map(value => ({ value, label: value }));
  const update = (values: Partial<PrfFormState>) => setForm({ ...form, ...values });
  // Selecting a site instantly fills Funding Source from that exact workbook row; when the site carries more
  // than one funding source the dropdown is restricted to just those rows and the first is pre-filled.
  const selectSite = (nextKey: string) => {
    const choices = accounting.filter(option => option.siteKey === nextKey),
      site = choices[0];
    update({
      siteKey: nextKey,
      siteCode: site?.siteCode || "",
      siteName: site?.siteName || "",
      school: site?.siteName || "",
      fundingCode: site?.fundingSource || "",
      region: site?.region || "",
    });
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
  const canSubmit = Boolean(
    form.siteCode &&
      form.fundingCode &&
      form.paymentType &&
      form.vendor &&
      amountOf(form.amount) > 0 &&
      !negativeLines &&
      !vague(form.description) &&
      form.requestorName &&
      form.requestorSignature &&
      form.requestorDate &&
      !blocked,
  );

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
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (canSubmit) onProceed();
          }}
          className="prfPaper"
        >
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
            <SearchableCombobox
              label="SITE"
              value={siteKey}
              options={siteOptions}
              onChange={selectSite}
              placeholder="Search all sites by name or code…"
            />
            <SearchableCombobox
              label="FUNDING SOURCE"
              value={form.fundingCode}
              options={fundingOptions}
              onChange={value => update({ fundingCode: value })}
              disabled={!siteKey}
              placeholder={siteKey ? "Search funding source…" : "Select a site first"}
            />
            <small>{accountingStatus}</small>
          </section>
          <fieldset className="paymentTypes">
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
          </fieldset>
          <section className="vendorBlock">
            <h3>Vendor*/Payee/Cardholder:</h3>
            <label>
              Name:
              <input value={form.vendor} onChange={event => update({ vendor: event.target.value })} />
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
          <div className="lineTableWrap">
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
          </div>
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
              <label>
                Requestor Print Name
                <input value={form.requestorName} onChange={event => update({ requestorName: event.target.value })} />
              </label>
              <SignatureField
                value={form.requestorSignature}
                mode={form.signatureMode as SignatureMode}
                onMode={value => update({ signatureMode: value, requestorSignature: "" })}
                onChange={value => update({ requestorSignature: value })}
              />
              <label>
                Date
                <input
                  type="date"
                  value={form.requestorDate}
                  onChange={event => update({ requestorDate: event.target.value })}
                />
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
          {notice && <div className="formNotice">{notice}</div>}
          <footer className="editorActions">
            <button type="button" className="secondary" onClick={() => onSave(false)}>
              Save Open Draft
            </button>
            <button type="submit" disabled={!canSubmit}>
              Sign &amp; Submit for Approval
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
