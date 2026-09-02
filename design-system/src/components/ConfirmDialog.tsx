"use client";

export type ConfirmDialogProps = {
  title: string;
  message: string;
  /** Label on the button that goes ahead. Name the action, not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Styles the confirm button as destructive and puts the cancel button first. */
  destructive?: boolean;
};

/**
 * A confirmation the application draws itself.
 *
 * window.confirm() would do the same job in one line, and this replaces it deliberately: the browser
 * dialog cannot say which draft is about to go, cannot be styled to mark a destructive action, and blocks
 * the whole page while it is open. For a delete that cannot be undone, the confirmation is worth building.
 *
 * On a destructive prompt the cancel button comes first and holds the visual weight, so the muscle-memory
 * click is the safe one.
 *
 * ```tsx
 * {pendingDelete && (
 *   <ConfirmDialog
 *     destructive
 *     title="Delete this draft?"
 *     message={`${pendingDelete.id} will be permanently deleted. This cannot be undone.`}
 *     confirmLabel="Delete draft"
 *     onConfirm={confirmDelete}
 *     onCancel={() => setPendingDelete(null)}
 *   />
 * )}
 * ```
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <div className="modalBackdrop confirmBackdrop">
      <section className="confirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="confirmActions">
          <button type="button" className="secondary" autoFocus onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={destructive ? "confirmDestructive" : ""} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
