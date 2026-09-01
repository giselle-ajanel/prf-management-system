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
  RequestForm,
  DEFAULT_PRF_RULES,
  DEFAULT_PAYMENT_TYPES,
  DEFAULT_EXPENSE_TYPES,
  type RequestFormProps,
  type PrfFormState,
  type PrfLineDraft,
  type PrfRule,
  type PrfRuleContext,
} from "./components/RequestForm";

// Components assembled from markup that was written inline in the original page rather than extracted
// from an existing function. Each is verified against the exact slice of the app's own rendered output.
export { AppHeader, type AppHeaderProps, type NavItem } from "./components/AppHeader";
export { Hero, type HeroProps, type HeroTrailCard } from "./components/Hero";
export {
  ActionRow,
  ReviewPanel,
  TipPanel,
  type ActionRowProps,
  type ReviewPanelProps,
  type TipPanelProps,
} from "./components/ActionRow";
export { AppFooter, type AppFooterProps } from "./components/AppFooter";
export { SessionDialog, type SessionDialogProps } from "./components/SessionDialog";
export { QueueItem, type QueueItemProps } from "./components/QueueItem";
export { StatCard, type StatCardProps, type StatTone } from "./components/StatCard";
export { RuleBanner, type RuleBannerProps, type RuleTone } from "./components/RuleBanner";

export {
  sampleRequests,
  sampleDistricts,
  sampleAccounting,
  emptyFinanceFilters,
  blankPrfLine,
  emptyPrfForm,
  filledPrfForm,
} from "./fixtures";
