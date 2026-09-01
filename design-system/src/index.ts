// Purchase Request Hub design system — public entry point.
//
// Import the stylesheet once at the application root:
//
//   import "@ds/styles/styles.css";
//
// Every component below reads the tokens defined in that stylesheet's first layer, so a component rendered
// without it will be structurally correct but completely unstyled.

export type {
  View,
  Status,
  LineItem,
  Approval,
  AuditEvent,
  Request,
  AccountingCode,
  ComboOption,
} from "./types";

export {
  MAX_AMOUNT,
  amountOf,
  isNegative,
  countOf,
  money,
  vague,
  routeFor,
  siteKeyOf,
  currentMonth,
  monthLabel,
} from "./utils";

export { StatusPill, type StatusPillProps } from "./components/StatusPill";
export { PageHead, type PageHeadProps } from "./components/PageHead";
export {
  MonthFilter,
  recentMonths,
  DEFAULT_MONTHS,
  type MonthFilterProps,
  type MonthOption,
} from "./components/MonthFilter";
export { SignatureField, type SignatureFieldProps, type SignatureMode } from "./components/SignatureField";
export { SearchableCombobox, type SearchableComboboxProps } from "./components/SearchableCombobox";
export { Summary, type SummaryProps } from "./components/Summary";
export { RequestTrail, type RequestTrailProps } from "./components/RequestTrail";
export { RequestModal, type RequestModalProps } from "./components/RequestModal";
export { Finance, type FinanceProps, type FinanceFilters } from "./components/Finance";

export {
  sampleRequests,
  sampleDistricts,
  sampleAccounting,
  emptyFinanceFilters,
} from "./fixtures";
