/**
 * Provider-independent financial statement types for NSE/BSE and NASDAQ/NYSE companies.
 *
 * Conventions (every provider adapter must normalise to these):
 * - Monetary amounts are in BASE units of `currency` (₹ or $), never lakhs/crores/millions.
 * - `null` means "not reported / not available". It is never replaced with 0 or an estimate.
 * - Cash-flow items keep their reported sign: inflows positive, outflows NEGATIVE
 *   (e.g. capitalExpenditure −5e9, dividendsPaid −2e9).
 * - Per-share values (EPS) are in `currency` per share; share counts are absolute numbers.
 * - Dates are "YYYY-MM-DD".
 *
 * Figures come only from a provider (or the deterministic mock). Nothing here, including any
 * future AI layer, may estimate or invent a financial figure.
 */

export type Amount = number | null;
export type PeriodType = "annual" | "quarterly";

export interface FiscalPeriod {
  type: PeriodType;
  /** Fiscal year label, e.g. 2026 for India's FY2025-26 (Apr 2025 – Mar 2026). */
  fiscalYear: number;
  /** 1–4 for quarterly periods, null for annual periods. */
  fiscalQuarter: 1 | 2 | 3 | 4 | null;
  periodStart: string;
  periodEnd: string;
  /** When the results were published, if known. */
  filedAt: string | null;
}

export interface IncomeStatement {
  revenue: Amount;
  costOfRevenue: Amount;
  grossProfit: Amount;
  operatingExpenses: Amount;
  operatingIncome: Amount;
  interestExpense: Amount;
  pretaxIncome: Amount;
  incomeTax: Amount;
  netIncome: Amount;
  epsBasic: Amount;
  epsDiluted: Amount;
  sharesBasic: Amount;
  sharesDiluted: Amount;
}

export interface BalanceSheet {
  cashAndEquivalents: Amount;
  shortTermInvestments: Amount;
  totalCurrentAssets: Amount;
  totalAssets: Amount;
  totalCurrentLiabilities: Amount;
  totalDebt: Amount;
  totalLiabilities: Amount;
  totalEquity: Amount;
  sharesOutstanding: Amount;
}

export interface CashFlowStatement {
  operatingCashFlow: Amount;
  capitalExpenditure: Amount; // negative = cash spent
  investingCashFlow: Amount;
  financingCashFlow: Amount;
  dividendsPaid: Amount; // negative = cash paid out
  shareRepurchases: Amount; // negative = cash paid out
}

/** A filing that supplied figures for a period (e.g. an SEC 10-K or 10-Q). */
export interface SourceFiling {
  accessionNumber: string;
  form: string;
  filedAt: string; // YYYY-MM-DD
}

/** One reporting period. A statement is null when the provider did not supply it at all. */
export interface FinancialStatementSet {
  period: FiscalPeriod;
  income: IncomeStatement | null;
  balance: BalanceSheet | null;
  cashFlow: CashFlowStatement | null;
  /** Filings the figures were taken from, oldest first (optional; mock data has none). */
  sources?: SourceFiling[];
}

/** Where the figures came from. "mock" data must never be presented as real. */
export type DataOrigin = "real" | "mock";

export interface FundamentalsProvenance {
  /** Provider id, e.g. "mint-mock-fundamentals". */
  source: string;
  origin: DataOrigin;
  /** When Mint obtained the data (UTC ISO). */
  fetchedAt: string;
}

export interface CompanyFundamentals {
  symbol: string;
  market: string; // Mint market code: NSE, BSE, NASDAQ, NYSE
  /** ISO 4217 reporting currency; must match the instrument's currency. */
  currency: string;
  /** Fiscal year end as "MM-DD", e.g. "03-31" for most Indian companies. */
  fiscalYearEnd: string;
  annual: FinancialStatementSet[];
  quarterly: FinancialStatementSet[];
  provenance: FundamentalsProvenance;
  /** Provider notes about coverage or mapping, e.g. why a figure is always null. */
  notes?: string[];
}

/** Markets for which fundamental data is meaningful in Mint. */
export const FUNDAMENTALS_MARKETS = ["NSE", "BSE", "NASDAQ", "NYSE"] as const;

export interface FundamentalsInstrumentRef {
  symbol: string;
  market: string;
  type: "EQUITY" | "INDEX" | "ETF";
  currency: string;
}

export const INCOME_FIELDS = [
  "revenue", "costOfRevenue", "grossProfit", "operatingExpenses", "operatingIncome", "interestExpense",
  "pretaxIncome", "incomeTax", "netIncome", "epsBasic", "epsDiluted", "sharesBasic", "sharesDiluted",
] as const satisfies readonly (keyof IncomeStatement)[];

export const BALANCE_FIELDS = [
  "cashAndEquivalents", "shortTermInvestments", "totalCurrentAssets", "totalAssets", "totalCurrentLiabilities",
  "totalDebt", "totalLiabilities", "totalEquity", "sharesOutstanding",
] as const satisfies readonly (keyof BalanceSheet)[];

export const CASH_FLOW_FIELDS = [
  "operatingCashFlow", "capitalExpenditure", "investingCashFlow", "financingCashFlow", "dividendsPaid", "shareRepurchases",
] as const satisfies readonly (keyof CashFlowStatement)[];
