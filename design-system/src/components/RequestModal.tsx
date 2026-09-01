"use client";

import type { Request } from "../types";
import { money } from "../utils";
import { PrfNumber } from "./PrfNumber";
import { StatusPill } from "./StatusPill";

export type RequestModalProps = {
  request: Request;
  onClose: () => void;
  /** Whether the audit trail section is expanded. */
  auditOpen: boolean;
  setAuditOpen: (open: boolean) => void;
  /** Shows the Return/Approve footer. Callers should gate this on the viewer's role and the request status. */
  canApprove: boolean;
  onAction: (request: Request, action: "Approved" | "Returned") => void;
};

/**
 * Full detail view for one request: coding summary, line items, documents, approval path, and the
 * expandable immutable audit record.
 *
 * Renders its own backdrop, so mount it at the end of the page rather than inside a layout container.
 *
 * ```tsx
 * {selected && (
 *   <RequestModal
 *     request={selected}
 *     onClose={() => setSelected(null)}
 *     auditOpen={auditOpen}
 *     setAuditOpen={setAuditOpen}
 *     canApprove={selected.status === "Awaiting Approval"}
 *     onAction={approve}
 *   />
 * )}
 * ```
 */
export function RequestModal({
  request,
  onClose,
  auditOpen,
  setAuditOpen,
  canApprove,
  onAction,
}: RequestModalProps) {
  return (
    <div className="modalBackdrop">
      <section className="modal detailModal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="modalHead">
          <div>
            <StatusPill status={request.status} />
            <h2 id="detail-title">{request.id}</h2>
            <p>
              {request.district} — {request.school}
            </p>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="detailSummary">
          <div>
            <small>VENDOR</small>
            <strong>{request.vendor}</strong>
          </div>
          <div>
            <small>TOTAL</small>
            <strong>{money(request.amount)}</strong>
          </div>
          <div>
            <small>CODING</small>
            <strong>
              {request.siteCode || (request.customSite ? "UNLISTED" : "")} · {request.fundingCode}
            </strong>
            <PrfNumber id={request.id} paymentType={request.paymentType} verbose />
          </div>
        </div>
        <div className="detailColumns">
          <div>
            <h3>Purpose & line items</h3>
            <p>{request.description}</p>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty.</th>
                  <th>Unit price</th>
                </tr>
              </thead>
              <tbody>
                {request.lineItems.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td>{l.quantity}</td>
                    <td>{money(l.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Documents</h3>
            {request.documents.length ? (
              request.documents.map(d => (
                <span className="document" key={d}>
                  ▣ {d}
                </span>
              ))
            ) : (
              <p className="muted">No documents attached.</p>
            )}
          </div>
          <div>
            <h3>Approval path</h3>
            {request.approvals.length ? (
              request.approvals.map((a, i) => (
                <div className="approval" key={i}>
                  <span>{a.status === "Signed" ? "✓" : a.status === "Returned" ? "!" : "○"}</span>
                  <div>
                    <strong>{a.role}</strong>
                    <p>
                      {a.name} · {a.status}
                    </p>
                    <small>{a.time}</small>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Approval path appears after submission.</p>
            )}
            <button className="secondary full" onClick={() => setAuditOpen(!auditOpen)}>
              ☷ {auditOpen ? "Hide" : "View"} audit trail
            </button>
          </div>
        </div>
        {auditOpen && (
          <div className="audit">
            <h3>Immutable activity record</h3>
            {request.audit.map((a, i) => (
              <div key={i}>
                <time>{a.time}</time>
                <p>
                  <strong>{a.event}</strong>
                  <br />
                  <span>{a.actor}</span>
                </p>
              </div>
            ))}
          </div>
        )}
        {canApprove && (
          <div className="modalActions">
            <button className="secondary" onClick={() => onAction(request, "Returned")}>
              Return for changes
            </button>
            <button onClick={() => onAction(request, "Approved")}>Approve & sign →</button>
          </div>
        )}
      </section>
    </div>
  );
}
