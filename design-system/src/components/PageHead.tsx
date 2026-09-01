import type { ReactNode } from "react";

export type PageHeadProps = {
  /** Small uppercase label above the title. Rendered in coral via the `.eyebrow` style. */
  eyebrow: string;
  /** Page title. Renders as the page's `h1`. */
  title: string;
  /** Supporting sentence beneath the title. */
  copy: string;
  /** Optional controls pinned to the right of the head — filters, a primary action, or both. */
  action?: ReactNode;
};

/**
 * Standard page header: eyebrow, title, supporting copy, and an optional action slot.
 *
 * Used at the top of every full-page view to keep titling consistent.
 *
 * ```tsx
 * <PageHead
 *   eyebrow="Requester workspace"
 *   title="My Requests"
 *   copy="Resume drafts, track approvals, and retrieve completed requests."
 *   action={<button>＋ New request</button>}
 * />
 * ```
 */
export function PageHead({ eyebrow, title, copy, action }: PageHeadProps) {
  return (
    <div className="pageHead">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  );
}
