"use client";

import type { Request } from "../types";
import { money } from "../utils";
import { StatusPill } from "./StatusPill";

export type RequestTrailProps = {
  requests: Request[];
  /** Opens a non-draft request. Wired to the detail modal. */
  onOpen: (request: Request) => void;
  /** Reopens a draft in the editor. */
  onResume: (request: Request) => void;
  /** Section heading. */
  title: string;
  /**
   * Deletes a draft.
   *
   * Defaults to dispatching a `delete-prf-draft` CustomEvent on `window` carrying the request id, which is
   * how the original Hub wired this up — the card is rendered deep inside a list and the delete handler
   * lives in the page component. Prefer passing an explicit handler; the event default exists so existing
   * listeners keep working.
   */
  onDelete?: (request: Request) => void;
  /** Small uppercase label above the heading. */
  eyebrow?: string;
  /** Supporting sentence beneath the heading. */
  intro?: string;
};

const dispatchDelete = (request: Request) =>
  window.dispatchEvent(new CustomEvent("delete-prf-draft", { detail: request.id }));

/**
 * Card grid of requests. Draft cards offer Resume and Delete; every other status offers Open.
 *
 * Cards cycle through three accent tones (`tone-0`, `tone-1`, `tone-2`) by index, so a grid stays visually
 * varied without the caller choosing colours.
 *
 * ```tsx
 * <RequestTrail
 *   requests={mine}
 *   title="Your request trail"
 *   onOpen={setSelected}
 *   onResume={resume}
 *   onDelete={deleteDraft}
 * />
 * ```
 */
export function RequestTrail({
  requests,
  onOpen,
  onResume,
  title,
  onDelete = dispatchDelete,
  eyebrow = "KEEP THINGS MOVING",
  intro = "Open a card for live status, items, approvals, documents, and audit history.",
}: RequestTrailProps) {
  return (
    <section className="content">
      <div className="sectionIntro">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{intro}</p>
      </div>
      <div className="requestGrid">
        {requests.map((r, i) => (
          <article className="requestCard" key={r.id}>
            <div className={`cardTop tone-${i % 3}`}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <StatusPill status={r.status} />
            </div>
            <div className="cardBody">
              <small>
                {r.id} · {r.school}
              </small>
              <h3>{r.vendor}</h3>
              <p>{r.description}</p>
              <strong>{money(r.amount)}</strong>
              {r.status === "Draft" ? (
                <div className="draftActions">
                  <button className="resumeButton" onClick={() => onResume(r)}>
                    Resume PRF →
                  </button>
                  <button className="deleteDraftButton" onClick={() => onDelete(r)} aria-label={`Delete ${r.id}`}>
                    Delete Draft
                  </button>
                </div>
              ) : (
                <button className="linkButton" onClick={() => onOpen(r)}>
                  Open request <span>→</span>
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
