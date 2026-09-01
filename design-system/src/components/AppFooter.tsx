import type { ReactNode } from "react";

export type AppFooterProps = {
  /** Product name. */
  title?: ReactNode;
  /** Tagline beside the name. */
  tagline?: ReactNode;
  /** Small trailing note — build status, environment, data provenance. */
  note?: ReactNode;
};

/**
 * Dark application footer: name, tagline, and a small provenance note.
 *
 * ```tsx
 * <AppFooter />
 * ```
 */
export function AppFooter({
  title = "Purchase Request Hub",
  tagline = "Clear requests. Confident approvals. Better records.",
  note = "Secure prototype · Sample data",
}: AppFooterProps) {
  return (
    <footer>
      <strong>{title}</strong>
      <span>{tagline}</span>
      <small>{note}</small>
    </footer>
  );
}
