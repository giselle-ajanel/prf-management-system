// Funding source periods and the option lists built from them.
//
// Purchasing runs in periods, and the paper form names them explicitly ("Camino Nuevo Summer 26" rather
// than a bare "Camino Nuevo"). The workbook mostly does not: of the funding sources it lists, only a
// handful carry a period. These helpers expand the rest into the three periods currently in use.
//
// Generated variants are flagged `generated: true` and carry a visible tag. That distinction matters —
// a workbook name is a code Finance issued, whereas a generated one is derived by this rule and may not
// correspond to anything in the accounting system yet.

import type { AccountingCode, ComboOption } from "./types";

/** The periods every expandable funding source is offered in, in display order. */
export const FUNDING_PERIODS = ["Summer 26", "26-27", "27-28"] as const;

/**
 * Funding sources that are never period-split.
 *
 * Shared indirect funding is not tied to a school year, so "WRSHARED Summer 26" would be meaningless.
 */
export const PERIOD_EXEMPT = [/^wrshared$/i, /^woodcraft\s*rangers$/i, /^woodcraft$/i];

/** Matches a name that already states its own period, so it is not expanded again. */
export const ALREADY_PERIODIC = /\d{2}\s*-\s*\d{2}|\bsummer\b|\bfy\s*\d{2}/i;

/** True when a funding source should be offered as-is rather than split into periods. */
export function isPeriodExempt(fundingSource: string): boolean {
  const name = fundingSource.trim();
  if (!name) return true;
  if (PERIOD_EXEMPT.some(pattern => pattern.test(name))) return true;
  // "Central 26-27" is already period-specific; expanding it would yield "Central 26-27 Summer 26".
  return ALREADY_PERIODIC.test(name);
}

/**
 * Expands one funding source into its period variants.
 *
 * Returns the name unchanged (as a single entry) when it is exempt or already carries a period.
 *
 * ```ts
 * expandFundingPeriods("Camino Nuevo");
 * // ["Camino Nuevo Summer 26", "Camino Nuevo 26-27", "Camino Nuevo 27-28"]
 * expandFundingPeriods("WRSHARED");   // ["WRSHARED"]
 * expandFundingPeriods("TUPE 25-26"); // ["TUPE 25-26"]
 * ```
 */
export function expandFundingPeriods(
  fundingSource: string,
  periods: readonly string[] = FUNDING_PERIODS,
): string[] {
  const name = fundingSource.trim();
  if (!name) return [];
  if (isPeriodExempt(name)) return [name];
  return periods.map(period => `${name} ${period}`);
}

/** One funding choice offered for a site. */
export type FundingChoice = {
  /** The value stored on the request. */
  value: string;
  /** The workbook funding source it derives from. */
  base: string;
  /** Present when this is a generated period variant. */
  period?: string;
  /** True when produced by period expansion rather than read from the workbook. */
  generated: boolean;
  fundingSourceId?: string;
  expenseType?: string;
  notes?: string;
};

/**
 * Builds every funding choice available to one site, in workbook order, each expanded into its periods.
 *
 * `rows` is the accounting rows sharing a site key — the same grouping the site dropdown uses — so the
 * funding list stays scoped to what that site may actually draw on.
 */
export function fundingChoicesFor(
  rows: AccountingCode[],
  periods: readonly string[] = FUNDING_PERIODS,
): FundingChoice[] {
  const choices: FundingChoice[] = [];
  const seen = new Set<string>();
  // De-duplicate by funding source: a site often repeats one source across several expense-type rows.
  const bases = [...new Map(rows.filter(row => row.fundingSource).map(row => [row.fundingSource, row])).values()];
  for (const row of bases) {
    const expanded = expandFundingPeriods(row.fundingSource, periods);
    const generated = expanded.length > 1 || expanded[0] !== row.fundingSource;
    for (const value of expanded) {
      if (seen.has(value)) continue;
      seen.add(value);
      choices.push({
        value,
        base: row.fundingSource,
        period: generated ? value.slice(row.fundingSource.length + 1) : undefined,
        generated,
        fundingSourceId: row.fundingSourceId || undefined,
        expenseType: row.expenseType || undefined,
        notes: row.notes || undefined,
      });
    }
  }
  return choices;
}

/**
 * Funding options for the combobox, scoped to one site.
 *
 * `current` keeps a value the request already holds selectable even when it is not in the list — an older
 * PRF may reference a bare funding source from before period expansion, or a manually typed one.
 */
export function buildFundingOptions(
  rows: AccountingCode[],
  current = "",
  periods: readonly string[] = FUNDING_PERIODS,
): ComboOption[] {
  const choices = fundingChoicesFor(rows, periods);
  const options: ComboOption[] = [
    { value: "", label: "-- select --" },
    ...choices.map(choice => ({
      value: choice.value,
      label: choice.value,
      search: [choice.value, choice.base, choice.fundingSourceId, choice.expenseType].filter(Boolean).join(" "),
      title: choice.notes || (choice.generated ? `Period variant generated from "${choice.base}"` : undefined),
      tag: choice.generated ? choice.period : undefined,
    })),
  ];
  if (current && !options.some(option => option.value === current)) {
    options.push({
      value: current,
      label: current,
      search: current,
      title: "Not in the current funding list for this site",
      tag: "as entered",
    });
  }
  return options;
}
