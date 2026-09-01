import type { ReactNode } from "react";

/** `info` is advisory; `blocked` signals something that prevents submission. */
export type RuleTone = "info" | "blocked";

export type RuleBannerProps = {
  tone: RuleTone;
  title: ReactNode;
  message: ReactNode;
};

/**
 * Inline policy notice with a coloured left border — teal for advisory, coral for blocking.
 *
 * This is the presentation half of {@link PrfRule}: the editor renders one per active rule. Use it
 * directly for one-off notices that are not part of a rule set.
 *
 * ```tsx
 * <RuleBanner tone="blocked" title="Funding restriction" message="We cannot use ASSET funding for transportation." />
 * ```
 */
export function RuleBanner({ tone, title, message }: RuleBannerProps) {
  return (
    <div className={`ruleBanner ${tone}`}>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}
