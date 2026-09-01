import { monthLabel } from "../utils";

export type MonthOption = {
  /** `YYYY-MM` key, compared against the `approvedAt` prefix of a request. */
  value: string;
  /** Text shown in the dropdown. */
  label: string;
};

export type MonthFilterProps = {
  /** Currently selected `YYYY-MM` key, or `""` for no filter. */
  value: string;
  onChange: (value: string) => void;
  /** Selectable months, newest first. Defaults to the three months the Hub shipped with. */
  months?: MonthOption[];
  /** Field label. */
  label?: string;
  /** Text for the unfiltered option. */
  allLabel?: string;
};

/**
 * Builds month options counting back from a starting month.
 *
 * ```tsx
 * <MonthFilter value={month} onChange={setMonth} months={recentMonths(6, "2026-08")} />
 * ```
 */
export function recentMonths(count: number, from: string): MonthOption[] {
  const [year, month] = from.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    const value = date.toISOString().slice(0, 7);
    return { value, label: `Approved in ${monthLabel(value)}` };
  });
}

/** The months the Hub shipped with, kept as the default so existing call sites are unchanged. */
export const DEFAULT_MONTHS: MonthOption[] = [
  { value: "2026-08", label: "Approved in August 2026" },
  { value: "2026-07", label: "Approved in July 2026" },
  { value: "2026-06", label: "Approved in June 2026" },
];

/**
 * Month/year dropdown used to narrow a list to requests approved in one month.
 *
 * ```tsx
 * <MonthFilter value={monthFilter} onChange={setMonthFilter} />
 * ```
 */
export function MonthFilter({
  value,
  onChange,
  months = DEFAULT_MONTHS,
  label = "Calendar month / year",
  allLabel = "All dates",
}: MonthFilterProps) {
  return (
    <label className="monthFilter">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {months.map(month => (
          <option key={month.value} value={month.value}>
            {month.label}
          </option>
        ))}
      </select>
    </label>
  );
}
