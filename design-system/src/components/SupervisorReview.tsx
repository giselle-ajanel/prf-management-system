"use client";

import { useState } from "react";
import type { Request } from "../types";
import { money, tierFor } from "../utils";
import { PAYMENT_LABELS, submissionDate } from "../export";
import { PrfNumber } from "./PrfNumber";
import { RuleBanner } from "./RuleBanner";
import { StatusPill } from "./StatusPill";

export type SupervisorReviewProps = {
  request: Request;
  onClose: () => void;
  /** Approve and electronically sign. */
  onApprove: (request: Request) => void;
  /** Send back for revision. `note` is always a non-empty explanation. */
  onReject: (request: Request, note: string) => void;
  /**
   * Checklist shown before the approve action. Advisory — ticking every box is not enforced, because a
   * reviewer who disagrees with a box should be able to say so in a rejection rather than be stuck.
   */
  checklist?: string[];
  /**
   * Which gate this review is. The supervisor asks whether the purchase should happen; Finance asks
   * whether the paperwork behind an already-authorised purchase holds up. Different question, different
   * checklist, different words on the button.
   */
  gate?: "supervisor" | "finance";
  title?: string;
  approveLabel?: string;
  rejectLabel?: string;
};

export const FINANCE_REVIEW_CHECKLIST = [
  "Accounting code and funding source match the site and expense type",
  "Receipts, quotes or invoices are attached and legible",
  "Total matches the documentation, including shipping and tax",
  "Spending is allowable under the grant or funding restrictions",
];

export const DEFAULT_REVIEW_CHECKLIST = [
  "Funding source is eligible for this expense type and period",
  "Educational purpose is specific — what, how many, and for whom",
  "Vendor quote or documentation is attached",
  "Total matches the attached quote, including shipping and tax",
];

/**
 * The approver's review screen.
 *
 * Lays out everything a decision needs on one surface — who is asking, what site and funding it draws on,
 * the item breakdown, the total, and which authority level that total requires — then offers exactly two
 * outcomes.
 *
 * Rejection requires a written reason. A request bounced with no explanation leaves the requester
 * guessing, so the send-back action stays disabled until something is typed, and the note travels with
 * the request and into the notification the requester receives.
 *
 * ```tsx
 * <SupervisorReview
 *   request={selected}
 *   onClose={() => setSelected(null)}
 *   onApprove={r => approve(r, "Approved")}
 *   onReject={(r, note) => approve(r, "Returned", note)}
 * />
 * ```
 */
export function SupervisorReview({
  request,
  onClose,
  onApprove,
  onReject,
  gate = "supervisor",
  checklist = gate === "finance" ? FINANCE_REVIEW_CHECKLIST : DEFAULT_REVIEW_CHECKLIST,
  title = gate === "finance" ? "Finance review" : "Review request",
  approveLabel = gate === "finance" ? "✓ Approve for Payment" : "✓ Approve & Electronically Sign",
  rejectLabel = gate === "finance" ? "Reject / Return" : "Reject / Request Revision",
}: SupervisorReviewProps) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [ticked, setTicked] = useState<boolean[]>(() => checklist.map(() => false));

  const tier = tierFor(request.amount);
  // An unsigned request cannot be approved — the requester's signature is the first of the two the form
  // requires, and approving without it would produce a PRF that was never actually requested.
  const blocked = !request.requesterSigned;
  const noteReady = note.trim().length > 0;
  const checkedCount = ticked.filter(Boolean).length;

  return (
    <div className="modalBackdrop">
      <section className="modal reviewModal" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <div className="modalHead">
          <div>
            <StatusPill status={request.status} />
            <h2 id="review-title">{title}</h2>
            <PrfNumber id={request.id} paymentType={request.paymentType} verbose />
          </div>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="reviewFacts">
          <div>
            <small>REQUESTER</small>
            <strong>{request.requester}</strong>
            <span>Submitted {submissionDate(request) || "—"}</span>
          </div>
          <div>
            <small>SITE</small>
            <strong>{request.school || "Unlisted site"}</strong>
            <span>{request.siteCode ? `Site ${request.siteCode}` : "No site code assigned"}</span>
          </div>
          <div>
            <small>FUNDING SOURCE</small>
            <strong>{request.fundingCode || "—"}</strong>
            <span>{PAYMENT_LABELS[request.paymentType || ""] || "Payment type not set"}</span>
          </div>
          <div>
            <small>VENDOR</small>
            <strong>{request.vendor}</strong>
            <span>{request.district}</span>
          </div>
        </div>

        {request.customSite && (
          <RuleBanner
            tone="info"
            title="Unlisted site"
            message={`"${request.school}" was entered manually and has no site code yet. Finance must assign one before this PRF can be coded.`}
          />
        )}
        {request.customFunding && (
          <RuleBanner
            tone="info"
            title="Unlisted funding source"
            message={`"${request.fundingCode}" was typed rather than chosen from the workbook. Confirm it is a valid code for this site and period.`}
          />
        )}
        {blocked && (
          <RuleBanner
            tone="blocked"
            title="Not signed by the requester"
            message="This request has no requester signature, so it cannot be approved. Send it back and ask them to sign and resubmit."
          />
        )}

        <section className="reviewAuthority">
          <div className="reviewTotal">
            <small>GRAND TOTAL</small>
            <strong>{money(request.amount)}</strong>
          </div>
          <div className="reviewTier">
            <small>{gate === "finance" ? "APPROVED BY" : "AUTHORIZATION REQUIRED"}</small>
            <strong>{gate === "finance" ? request.approverName || "Supervisor" : tier.role}</strong>
            <span>
              {gate === "finance"
                ? `${tier.band} · cleared gate 1, now checking coding and receipts`
                : `${tier.band} · all PRFs require two signatures`}
            </span>
          </div>
        </section>

        <div className="reviewColumns">
          <div>
            <h3>Item breakdown</h3>
            <table className="reviewItems">
              <thead>
                <tr>
                  <th>Item description and quantity</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {request.lineItems.length ? (
                  request.lineItems.map((line, index) => (
                    <tr key={index}>
                      <td>{line.description}</td>
                      <td>{money(line.quantity > 1 ? line.quantity * line.unitPrice : line.unitPrice)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="muted">
                      No line items recorded.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>GRAND TOTAL</td>
                  <td>{money(request.amount)}</td>
                </tr>
              </tfoot>
            </table>

            <h3>Documents</h3>
            {request.documents.length ? (
              request.documents.map(document => (
                <span className="document" key={document}>
                  ▣ {document}
                </span>
              ))
            ) : (
              <p className="muted">No documents attached — check whether a vendor quote is required.</p>
            )}
          </div>

          <div>
            <h3>
              Before you approve
              <small className="checklistCount">
                {checkedCount}/{checklist.length}
              </small>
            </h3>
            <ul className="reviewChecklist">
              {checklist.map((item, index) => (
                <li key={item}>
                  <label>
                    <input
                      type="checkbox"
                      checked={ticked[index] || false}
                      onChange={event =>
                        setTicked(previous => previous.map((value, i) => (i === index ? event.target.checked : value)))
                      }
                    />
                    <span>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="checklistNote">
              {gate === "finance"
                ? "Advisory only — if the coding or the documentation does not hold up, return it with a note saying what is wrong."
                : "Advisory only — if something here does not hold, send the request back with a note rather than approving it."}
            </p>
          </div>
        </div>

        {rejecting ? (
          <div className="rejectPanel">
            <label>
              <strong>Tell {request.requester} what needs to change</strong>
              <textarea
                autoFocus
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder="e.g. Please attach the vendor quote and split the transport line onto its own PRF."
              />
            </label>
            <div className="rejectActions">
              <small className={noteReady ? "ready" : "required"}>
                {noteReady ? "This note is sent to the requester." : "A comment is required to send a request back."}
              </small>
              <div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setRejecting(false);
                    setNote("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rejectConfirm"
                  disabled={!noteReady}
                  onClick={() => onReject(request, note.trim())}
                >
                  Send back for revision
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="modalActions reviewActions">
            <button type="button" className="secondary rejectStart" onClick={() => setRejecting(true)}>
              {rejectLabel}
            </button>
            <button
              type="button"
              className="approveSign"
              disabled={blocked}
              title={blocked ? "The requester has not signed this PRF" : undefined}
              onClick={() => onApprove(request)}
            >
              {approveLabel}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
