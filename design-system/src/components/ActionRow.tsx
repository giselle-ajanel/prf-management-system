"use client";

import type { ReactNode } from "react";

export type ActionRowProps = {
  /** Panels to lay out — the Hub pairs a ReviewPanel with a TipPanel. */
  children: ReactNode;
};

/**
 * Two-column band for call-to-action panels, wide panel first.
 *
 * ```tsx
 * <ActionRow>
 *   <ReviewPanel … />
 *   <TipPanel … />
 * </ActionRow>
 * ```
 */
export function ActionRow({ children }: ActionRowProps) {
  return <section className="actionRow">{children}</section>;
}

export type ReviewPanelProps = {
  eyebrow: ReactNode;
  title: ReactNode;
  copy: ReactNode;
  /** Label above the figure. */
  amountLabel?: ReactNode;
  /** The figure itself — pass pre-formatted currency. */
  amount: ReactNode;
  actionLabel: ReactNode;
  onAction: () => void;
};

/**
 * Wide teal panel summarising what is waiting on the viewer, with the total and a jump-in action.
 *
 * ```tsx
 * <ReviewPanel
 *   eyebrow="YOUR QUEUE"
 *   title="One request is ready for your review."
 *   copy="Student enrichment materials for Site 7704 have all required documents."
 *   amount={money(8425)}
 *   actionLabel="Review request →"
 *   onAction={() => navigate("approvals")}
 * />
 * ```
 */
export function ReviewPanel({
  eyebrow,
  title,
  copy,
  amountLabel = "TOTAL",
  amount,
  actionLabel,
  onAction,
}: ReviewPanelProps) {
  return (
    <article className="reviewPanel">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      <div className="reviewAmount">
        <small>{amountLabel}</small>
        <strong>{amount}</strong>
        <button onClick={onAction}>{actionLabel}</button>
      </div>
    </article>
  );
}

export type TipPanelProps = {
  /** Glyph in the corner badge. */
  icon?: ReactNode;
  title: ReactNode;
  copy: ReactNode;
  actionLabel: ReactNode;
  onAction: () => void;
};

/**
 * Narrow guidance panel — a single piece of advice with a link-style action.
 *
 * ```tsx
 * <TipPanel
 *   title="Help requests move faster"
 *   copy="Brief descriptions are flagged before submission."
 *   actionLabel="Create a clear request →"
 *   onAction={startNew}
 * />
 * ```
 */
export function TipPanel({ icon = "!", title, copy, actionLabel, onAction }: TipPanelProps) {
  return (
    <article className="tipPanel">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{copy}</p>
      <button className="linkButton" onClick={onAction}>
        {actionLabel}
      </button>
    </article>
  );
}
