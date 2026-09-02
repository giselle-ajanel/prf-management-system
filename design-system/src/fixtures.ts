// Sample data for previews, stories and tests.
//
// Lifted from the Hub's own seed set so anything rendered from these fixtures looks like the real product
// rather than lorem ipsum. The four requests deliberately cover all four lifecycle states and four
// different approval tiers, so a component rendered against `sampleRequests` exercises every visual branch
// it has — pill colours, draft-only actions, signed vs pending approvals, empty vs populated documents.
//
// This is sample data, not real purchasing records.

import type { AccountingCode, Request } from "./types";
import type { PrfFormState, PrfLineDraft } from "./components/RequestForm";

export const sampleRequests: Request[] = [
  {
    id: "PRF-FY27-0001",
    vendor: "Northstar Learning",
    description: "24 robotics kits for the Grade 9 after-school STEM lab",
    amount: 8425,
    status: "Pending Supervisor Approval",
    district: "District 4",
    school: "Central High School",
    siteCode: "7704",
    fundingCode: "88STEM",
    cycle: "FY2027 Cycle 01",
    requester: "Giselle Ajanel",
    updated: "Today, 9:06 AM",
    requesterSigned: true,
    lineItems: [
      { description: "Classroom robotics kit", quantity: 24, unitPrice: 325 },
      { description: "Shipping and handling", quantity: 1, unitPrice: 625 },
    ],
    approvals: [
      { role: "Requester", name: "Giselle Ajanel", status: "Signed", time: "Jul 29, 9:06 AM" },
      { role: "Director", name: "Marcus Lee", status: "Pending" },
    ],
    audit: [
      { time: "Jul 29, 9:06 AM", event: "Request submitted and electronically signed", actor: "Giselle Ajanel" },
      { time: "Jul 29, 9:06 AM", event: "Routed to Director based on $5,001–$15,000 threshold", actor: "System" },
      { time: "Jul 28, 3:42 PM", event: "Draft created", actor: "Giselle Ajanel" },
    ],
    documents: ["Northstar quote.pdf", "Program justification.pdf"],
  },
  {
    id: "PRF-FY27-0002",
    vendor: "City Office Supply",
    description: "Supplies",
    amount: 1284.6,
    status: "Draft",
    district: "District 4",
    school: "Central High School",
    siteCode: "7704",
    fundingCode: "WRSHARED",
    cycle: "FY2027 Cycle 01",
    requester: "Giselle Ajanel",
    updated: "Yesterday",
    lineItems: [{ description: "Supplies", quantity: 1, unitPrice: 1284.6 }],
    approvals: [],
    audit: [{ time: "Jul 30, 2:15 PM", event: "Draft saved", actor: "Giselle Ajanel" }],
    documents: [],
  },
  {
    id: "PRF-FY27-0003",
    vendor: "BrightPath Services",
    description: "Six-week literacy tutoring program for 40 middle-school students",
    amount: 24750,
    status: "Approved",
    district: "District 1",
    school: "Lincoln Middle School",
    siteCode: "7718",
    fundingCode: "ELOP27",
    cycle: "FY2027 Cycle 01",
    requester: "Maya Thompson",
    updated: "Aug 1",
    approvedAt: "2026-08-01T14:42:00",
    requesterSigned: true,
    approverSigned: true,
    lineItems: [{ description: "Literacy tutoring program", quantity: 1, unitPrice: 24750 }],
    approvals: [
      { role: "Requester", name: "Maya Thompson", status: "Signed", time: "Jul 30, 10:12 AM" },
      { role: "Senior Director", name: "Ana Rivera", status: "Signed", time: "Aug 1, 2:42 PM" },
    ],
    audit: [
      { time: "Aug 1, 2:42 PM", event: "Approved and electronically signed", actor: "Ana Rivera" },
      { time: "Jul 30, 10:12 AM", event: "Routed to Senior Director based on $15,001–$25,000 threshold", actor: "System" },
    ],
    documents: ["Service agreement.pdf"],
  },
  {
    id: "PRF-FY27-0004",
    vendor: "PlayWorks West",
    description: "Outdoor education equipment for 120 students",
    amount: 48900,
    status: "Needs Revision",
    district: "District 7",
    school: "Harbor STEM Academy",
    siteCode: "7732",
    fundingCode: "ELOP27",
    cycle: "FY2027 Cycle 02",
    requester: "Jordan Kim",
    updated: "Jul 31",
    lineItems: [{ description: "Outdoor education equipment package", quantity: 1, unitPrice: 48900 }],
    approvals: [
      { role: "Requester", name: "Jordan Kim", status: "Signed", time: "Jul 31, 11:20 AM" },
      { role: "Chief", name: "Unassigned", status: "Returned", time: "Aug 2, 8:15 AM" },
    ],
    audit: [
      { time: "Aug 2, 8:15 AM", event: "Returned for changes", actor: "Dana Ruiz" },
      { time: "Jul 31, 11:20 AM", event: "Routed to Chief based on $25,001–$75,000 threshold", actor: "System" },
    ],
    documents: ["Vendor proposal.pdf", "Insurance certificate.pdf"],
  },
];

/** District → schools map matching the sample requests above. */
export const sampleDistricts: Record<string, string[]> = {
  Woodcraft: ["Finance", "Marketing", "Development", "Operations"],
  "District 1": ["Roosevelt Elementary", "Lincoln Middle School"],
  "District 4": ["Central High School", "Jefferson Academy"],
  "District 7": ["Harbor STEM Academy", "Westview Elementary"],
};

/** A few accounting rows, enough to exercise the site and funding comboboxes and their grouping. */
export const sampleAccounting: AccountingCode[] = [
  { source: "FY27", fundingSource: "WRSHARED — Shared Indirect", fundingSourceId: "WRSHARED", siteCode: "1000", siteName: "Finance", siteKey: "1000|Finance", region: "Overhead", expenseType: "Program Supplies", status: "Active", notes: "", availability: "active" },
  { source: "School Site Codes FY27", fundingSource: "88STEM — STEM Enrichment", fundingSourceId: "88STEM", siteCode: "7704", siteName: "Central High School", siteKey: "7704|Central High School", region: "South", expenseType: "Program Supplies", status: "Active", notes: "STEM enrichment site", availability: "active" },
  { source: "School Site Codes FY27", fundingSource: "ELOP27 — Expanded Learning", fundingSourceId: "ELOP27", siteCode: "7711", siteName: "Roosevelt Elementary", siteKey: "7711|Roosevelt Elementary", region: "North", expenseType: "Program Supplies", status: "Active", notes: "", availability: "active" },
  { source: "School Site Codes FY27", fundingSource: "ELOP27 — Expanded Learning", fundingSourceId: "ELOP27", siteCode: "7732", siteName: "Harbor STEM Academy", siteKey: "7732|Harbor STEM Academy", region: "Harbor", expenseType: "Transportation", status: "Active", notes: "Expiring mid-year", availability: "expiring" },
  // A grant row: period-formatted funding name, no numeric site code — the shape the Grants tab produces.
  { source: "Grants", fundingSource: "TUPE 25-26", fundingSourceId: "LAU26Y06", siteCode: "", siteName: "TUPE 25-26", siteKey: "|TUPE 25-26", region: "", expenseType: "", status: "Active", notes: "", availability: "active" },
  // A department row from the Dept Codes tab.
  { source: "Dept Codes", fundingSource: "Marketing Dept", fundingSourceId: "", siteCode: "9907", siteName: "Marketing", siteKey: "9907|Marketing", region: "Woodcraft", expenseType: "Program Supplies, Lunch & Meeting", status: "Active", notes: "", availability: "active" },
  // A Finance override adding a period-specific funding source to a site the workbook already knows.
  // It merges into that site rather than creating a second entry, and its name joins the site's search text.
  { source: "Finance overrides", fundingSource: "Camino Nuevo Summer 26", fundingSourceId: "", siteCode: "7704", siteName: "Central High School", siteKey: "7704|Central High School", region: "South", expenseType: "Program Supplies", status: "Active", notes: "Added by Finance override", availability: "active" },
  // A Finance override introducing a site the workbook has never seen — the mid-year partnership case.
  { source: "Finance overrides", fundingSource: "Vista Verde 26-27", fundingSourceId: "", siteCode: "", siteName: "Vista Verde Academy", siteKey: "|Vista Verde Academy", region: "East", expenseType: "", status: "Active", notes: "New partnership, added by Finance override", availability: "active" },
];

/** Empty filter state for the Finance register. */
export const emptyFinanceFilters = { query: "", month: "", district: "", school: "", status: "", funding: "" };

/** A blank editor line. */
export const blankPrfLine = (): PrfLineDraft => ({
  description: "",
  expenseType: "Program Supplies",
  club: "",
  splitSite: "",
  amount: "",
});

/**
 * A fresh PRF editor state.
 *
 * `requestorDate` is fixed rather than set to today so anything rendered from this fixture — preview cards
 * especially — produces the same markup on every run.
 */
export const emptyPrfForm = (): PrfFormState => ({
  vendor: "",
  vendorAddress: "",
  vendorCity: "",
  vendorEmail: "",
  copyName: "",
  copyEmail: "",
  description: "",
  amount: "",
  district: "Woodcraft",
  school: "",
  siteKey: "",
  siteName: "",
  siteCode: "",
  fundingCode: "",
  region: "",
  expenseType: "Program Supplies",
  paymentType: "",
  lineItems: Array.from({ length: 10 }, blankPrfLine),
  requestorName: "Giselle Ajanel",
  requestorSignature: "",
  signatureMode: "type",
  requestorDate: "2026-08-31",
  supervisorName: "",
  supervisorSignature: "",
  supervisorDate: "",
  manualSite: "",
  manualFunding: "",
  justification: "",
});

/** A part-filled editor state: site and funding chosen, two lines entered, ready to sign. */
export const filledPrfForm = (): PrfFormState => {
  const form = emptyPrfForm();
  const lineItems = Array.from({ length: 10 }, blankPrfLine);
  lineItems[0] = { description: "24 classroom robotics kits for the Grade 9 after-school STEM lab", expenseType: "Program Supplies", club: "STEM Club", splitSite: "", amount: "7800" };
  lineItems[1] = { description: "Shipping and handling (1 delivery)", expenseType: "Program Supplies", club: "", splitSite: "", amount: "625" };
  return {
    ...form,
    vendor: "Northstar Learning",
    vendorAddress: "1200 Innovation Way",
    vendorCity: "Los Angeles, CA 90015",
    vendorEmail: "orders@northstarlearning.example",
    description: "24 classroom robotics kits for the Grade 9 after-school STEM lab; Shipping and handling (1 delivery)",
    amount: "8425",
    school: "Central High School",
    siteKey: "7704|Central High School",
    siteName: "Central High School",
    siteCode: "7704",
    fundingCode: "88STEM — STEM Enrichment",
    region: "South",
    paymentType: "direct",
    lineItems,
    requestorSignature: "Giselle Ajanel",
  };
};
