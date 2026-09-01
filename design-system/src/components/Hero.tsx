"use client";

import type { ReactNode } from "react";

export type HeroTrailCard = {
  /** Request identifier shown on the floating card. */
  id: ReactNode;
  /** Headline state, e.g. "Awaiting approval". */
  status: ReactNode;
  /** Supporting line, e.g. "Requester signed · Director next". */
  note: ReactNode;
};

export type HeroProps = {
  eyebrow: ReactNode;
  /** First line of the headline. */
  title: ReactNode;
  /** Second line, rendered in the accent colour. */
  titleAccent: ReactNode;
  copy: ReactNode;
  primaryLabel?: ReactNode;
  onPrimary?: () => void;
  secondaryLabel?: ReactNode;
  onSecondary?: () => void;
  /** Number in the sun motif — the Hub shows the fiscal year. */
  sunLabel?: ReactNode;
  /** Floating request card in the illustration. Omit to hide it. */
  trailCard?: HeroTrailCard;
};

/**
 * Overview hero: headline block beside a decorative landscape (sun, two hills, sparks) with a floating
 * request card.
 *
 * The illustration is `aria-hidden` — it carries no information the copy does not already state. The
 * headline renders as `{title}` / `{titleAccent}` on two lines, with the accent in yellow.
 *
 * ```tsx
 * <Hero
 *   eyebrow="FY 2027 · SPENDING CYCLE 01"
 *   title="Purchasing made"
 *   titleAccent="clear & connected."
 *   copy="Create, route, and track every purchase request in one friendly workspace."
 *   primaryLabel="Start a new request"
 *   onPrimary={startNew}
 *   secondaryLabel="View my requests"
 *   onSecondary={() => navigate("requests")}
 *   trailCard={{ id: "PRF-FY27-0001", status: "Awaiting approval", note: "Requester signed · Director next" }}
 * />
 * ```
 */
export function Hero({
  eyebrow,
  title,
  titleAccent,
  copy,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  sunLabel = "27",
  trailCard,
}: HeroProps) {
  return (
    <section className="hero">
      <div className="heroCopy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>
          {title}
          <br />
          <em>{titleAccent}</em>
        </h1>
        <p>{copy}</p>
        <div className="heroActions">
          {primaryLabel !== undefined && (
            <button onClick={onPrimary}>
              {primaryLabel} <span>→</span>
            </button>
          )}
          {secondaryLabel !== undefined && (
            <button className="textButton" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
      <div className="heroArt" aria-hidden="true">
        <div className="sun">{sunLabel}</div>
        <div className="hill hillBack" />
        <div className="hill hillFront" />
        {trailCard && (
          <div className="trailCard">
            <span>{trailCard.id}</span>
            <strong>{trailCard.status}</strong>
            <small>{trailCard.note}</small>
          </div>
        )}
        <div className="spark one">✦</div>
        <div className="spark two">✦</div>
      </div>
    </section>
  );
}
