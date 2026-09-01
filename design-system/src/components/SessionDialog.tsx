"use client";

import type { ReactNode } from "react";

export type SessionDialogProps = {
  /** Figure in the badge — the Hub shows the inactivity window in minutes. */
  badge?: ReactNode;
  title?: ReactNode;
  message?: ReactNode;
  actionLabel?: ReactNode;
  onRefresh: () => void;
};

/**
 * Blocking prompt shown after an inactivity timeout, reassuring the signer their draft was preserved.
 *
 * Uses `role="alertdialog"` rather than `dialog`: it interrupts, and there is nothing to do but
 * acknowledge it. Renders its own backdrop above every other modal layer.
 *
 * ```tsx
 * {sessionExpired && <SessionDialog onRefresh={() => setSessionExpired(false)} />}
 * ```
 */
export function SessionDialog({
  badge = "60",
  title = "Your session needs a refresh",
  message = "You have been inactive for one hour. Your PRF draft was saved safely and will remain under Open Drafts.",
  actionLabel = "Refresh session",
  onRefresh,
}: SessionDialogProps) {
  return (
    <div className="modalBackdrop sessionBackdrop">
      <section className="sessionPrompt" role="alertdialog" aria-modal="true">
        <span>{badge}</span>
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onRefresh}>{actionLabel}</button>
      </section>
    </div>
  );
}
