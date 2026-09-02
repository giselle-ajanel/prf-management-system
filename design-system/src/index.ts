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
  APPROVAL_TIERS,
  tierFor,
  routeFor,
  siteKeyOf,
  currentMonth,
  monthLabel,
  type ApprovalTier,
} from "./utils";

export {
  FUNDING_PERIODS,
  PERIOD_EXEMPT,
  ALREADY_PERIODIC,
  isPeriodExempt,
  expandFundingPeriods,
  fundingChoicesFor,
  buildFundingOptions,
  type FundingChoice,
} from "./funding";

export {
  notify,
  setTransport,
  currentTransport,
  noopTransport,
  unreadCount,
  markAllRead,
  relativeTime,
  type PrfNotification,
  type NotificationKind,
  type NotificationAudience,
  type NotificationTransport,
} from "./notifications";

export {
  EXPORT_COLUMNS,
  PAYMENT_LABELS,
  csvField,
  lineItemsCell,
  submissionDate,
  exportRow,
  toCsv,
  exportFilename,
  downloadCsv,
} from "./export";

export { NotificationBell, type NotificationBellProps } from "./components/NotificationBell";
export { ExportButton, type ExportButtonProps } from "./components/ExportButton";
export { PrfNumber, type PrfNumberProps } from "./components/PrfNumber";
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
export { SearchableCombobox, CUSTOM_OPTION, type SearchableComboboxProps } from "./components/SearchableCombobox";
export { Summary, type SummaryProps } from "./components/Summary";
export { RequestTrail, type RequestTrailProps } from "./components/RequestTrail";
export { RequestModal, type RequestModalProps } from "./components/RequestModal";
export { Finance, type FinanceProps, type FinanceFilters } from "./components/Finance";
export {
  RequestForm,
  DEFAULT_PRF_RULES,
  DEFAULT_PAYMENT_TYPES,
  DEFAULT_EXPENSE_TYPES,
  DEPARTMENT_TAB,
  SCHOOL_TAB,
  DEPARTMENT_GROUP,
  SCHOOL_GROUP,
  GRANT_GROUP,
  OVERRIDE_GROUP,
  OTHER_GROUP,
  DEFAULT_SITE_GROUPS,
  SITE_GROUP_ORDER,
  buildSiteOptions,
  toSiteOption,
  type RequestFormProps,
  type PrfFormState,
  type PrfLineDraft,
  type PrfRule,
  type PrfRuleContext,
  type NoticeTone,
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
export { LoginScreen, type LoginScreenProps, type Credentials } from "./components/LoginScreen";
export { ConfirmDialog, type ConfirmDialogProps } from "./components/ConfirmDialog";
export { AttachmentZone, ACCEPTED_UPLOADS, fileSize, type AttachmentZoneProps, type AttachmentSummary } from "./components/AttachmentZone";
export {
  ProfileSettings,
  type ProfileSettingsProps,
  type ProfileFields,
  type DirectoryEntry,
} from "./components/ProfileSettings";
export {
  SupervisorReview,
  DEFAULT_REVIEW_CHECKLIST,
  type SupervisorReviewProps,
} from "./components/SupervisorReview";

// Fixtures are deliberately NOT re-exported here — import them from "@ds/fixtures".
//
// Next's bundler does tree-shake them out of the app today, but the app reaches this barrel through a
// tsconfig path alias, which bypasses package.json resolution and with it the "sideEffects" hint. That
// makes the elimination a property of the current bundler rather than something the package guarantees.
// Keeping sample data out of the public entry point makes it structural instead.
