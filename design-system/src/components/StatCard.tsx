import type { ReactNode } from "react";

/** Accent colours available to a stat card's icon chip. */
export type StatTone = "coral" | "yellow" | "mint" | "blue";

export type StatCardProps = {
  /** Accent colour for the icon chip. */
  tone: StatTone;
  /** Glyph shown in the chip — the Hub uses ✎ ↗ ✓ ▣. */
  icon: ReactNode;
  /** The headline figure. */
  value: ReactNode;
  /** What the figure counts. */
  label: ReactNode;
  /** Supporting detail beneath the label. */
  note?: ReactNode;
};

/**
 * A single tile in a stat band: coloured icon chip, headline figure, label and a note.
 *
 * Designed to sit in a four-across grid — see {@link Summary}, which is built from four of these.
 *
 * ```tsx
 * <StatCard tone="mint" icon="✓" value={12} label="Approved requests" note="$104,300 cleared" />
 * ```
 */
export function StatCard({ tone, icon, value, label, note }: StatCardProps) {
  return (
    <article>
      <span className={`statIcon ${tone}`}>{icon}</span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
        {note !== undefined && <small>{note}</small>}
      </div>
    </article>
  );
}
