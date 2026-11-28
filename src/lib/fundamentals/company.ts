/**
 * Provider-independent company identity and filing metadata. Values are copied from the source
 * (e.g. SEC EDGAR) as reported; nothing is inferred or filled in.
 */

export interface CompanyIdentity {
  /** Provider id, e.g. "sec-edgar". */
  source: string;
  /** Registry identifiers. `cik` is SEC's 10-digit Central Index Key (with leading zeros). */
  identifiers: { cik?: string };
  name: string;
  tickers: string[];
  /** Exchange names as reported by the source, e.g. "Nasdaq", "NYSE". */
  exchanges: string[];
  entityType: string | null;
  /** Standard Industrial Classification code and description. */
  sic: string | null;
  sicDescription: string | null;
  /** Fiscal year end as "MM-DD", as reported (52/53-week filers report a nominal date). */
  fiscalYearEnd: string | null;
  stateOfIncorporation: string | null;
  formerNames: { name: string; from: string | null; to: string | null }[];
  /** When Mint obtained this data (UTC ISO). */
  fetchedAt: string;
}

/** Periodic financial reports relevant to fundamental analysis. */
export type FilingCategory = "annual" | "quarterly";

export interface FilingSummary {
  form: string; // e.g. "10-K", "10-Q", "10-K/A"
  category: FilingCategory;
  isAmendment: boolean;
  accessionNumber: string; // e.g. "0000320193-26-000026"
  filingDate: string; // YYYY-MM-DD
  /** Period the report covers (YYYY-MM-DD); null when the source leaves it blank. */
  reportDate: string | null;
  primaryDocument: string | null;
  isXbrl: boolean;
  isInlineXbrl: boolean;
  /** Filing index page on the source's website. */
  indexUrl: string;
  /** Direct link to the primary document, when one is listed. */
  documentUrl: string | null;
}

export interface CompanyFilings {
  filings: FilingSummary[]; // newest first
  /** Range of filing dates the source's "recent" list covered. */
  coveredFrom: string | null;
  coveredTo: string | null;
  /** Older filings exist in additional files that were not fetched. */
  olderFilingsNotLoaded: boolean;
}

/**
 * Forms Mint treats as periodic financial reports.
 * Annual: 10-K (US companies), 20-F and 40-F (foreign/Canadian issuers). Quarterly: 10-Q.
 * Amendments ("/A") are included and flagged.
 */
export const SUPPORTED_FILING_FORMS: Record<string, FilingCategory> = {
  "10-K": "annual",
  "20-F": "annual",
  "40-F": "annual",
  "10-Q": "quarterly",
};

export function classifyFilingForm(form: string): { category: FilingCategory; isAmendment: boolean } | null {
  const trimmed = form.trim().toUpperCase();
  const isAmendment = trimmed.endsWith("/A");
  const base = isAmendment ? trimmed.slice(0, -2) : trimmed;
  const category = SUPPORTED_FILING_FORMS[base];
  return category ? { category, isAmendment } : null;
}
