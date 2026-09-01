import { PAYMENT_LABELS } from "../export";

export type PrfNumberProps = {
  /** The immutable tracking number, e.g. PRF-FY27-0001. */
  id: string;
  /** Stored payment type key. `divvy` gets the reconciliation treatment. */
  paymentType?: string;
  /** Shows the full payment label rather than the short tag. */
  verbose?: boolean;
};

/**
 * The PRF tracking number, presented as a reference rather than as metadata.
 *
 * Every PRF carries a sequential, immutable number. For Divvy card purchases it is the only thing tying a
 * line on the monthly card statement back to an approved request, so a Divvy PRF is styled distinctly and
 * labelled — Finance should be able to find the number without hunting for it.
 *
 * ```tsx
 * <PrfNumber id={request.id} paymentType={request.paymentType} />
 * ```
 */
export function PrfNumber({ id, paymentType, verbose = false }: PrfNumberProps) {
  const isDivvy = paymentType === "divvy";
  const label = verbose ? PAYMENT_LABELS[paymentType || ""] : isDivvy ? "Divvy" : "";
  return (
    <span className={`prfNumber${isDivvy ? " divvy" : ""}`} title={isDivvy ? "Reconcile against the Divvy card statement" : undefined}>
      {id}
      {label && <small>{label}</small>}
    </span>
  );
}
