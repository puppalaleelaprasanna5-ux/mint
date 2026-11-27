/**
 * Validation of provider-supplied fundamentals. Pure and deterministic.
 *
 * Shape (Zod): every amount is a finite number or null; dates, currency and periods well formed.
 * Semantic ERRORS (data rejected): currency mismatch, duplicate or malformed periods, periods
 * ending in the future, non-positive share counts.
 * WARNINGS (data kept, flagged): accounting identities that don't add up within 1%, negative revenue.
 */
import { z } from "zod";
import type { CompanyFundamentals, FinancialStatementSet } from "./types";

const amount = z.number().finite().nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const incomeSchema = z.object({
  revenue: amount, costOfRevenue: amount, grossProfit: amount, operatingExpenses: amount, operatingIncome: amount,
  interestExpense: amount, pretaxIncome: amount, incomeTax: amount, netIncome: amount, epsBasic: amount,
  epsDiluted: amount, sharesBasic: amount, sharesDiluted: amount,
}).strict();

const balanceSchema = z.object({
  cashAndEquivalents: amount, shortTermInvestments: amount, totalCurrentAssets: amount, totalAssets: amount,
  totalCurrentLiabilities: amount, totalDebt: amount, totalLiabilities: amount, totalEquity: amount, sharesOutstanding: amount,
}).strict();

const cashFlowSchema = z.object({
  operatingCashFlow: amount, capitalExpenditure: amount, investingCashFlow: amount, financingCashFlow: amount,
  dividendsPaid: amount, shareRepurchases: amount,
}).strict();

const periodSchema = z.object({
  type: z.enum(["annual", "quarterly"]),
  fiscalYear: z.number().int().min(1990).max(2100),
  fiscalQuarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  periodStart: date,
  periodEnd: date,
  filedAt: date.nullable(),
}).strict();

const setSchema = z.object({
  period: periodSchema,
  income: incomeSchema.nullable(),
  balance: balanceSchema.nullable(),
  cashFlow: cashFlowSchema.nullable(),
}).strict();

export const companyFundamentalsSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  market: z.string().trim().min(1).max(10),
  currency: z.string().regex(/^[A-Z]{3}$/, "Expected ISO 4217 code"),
  fiscalYearEnd: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Expected MM-DD"),
  annual: z.array(setSchema).max(40),
  quarterly: z.array(setSchema).max(160),
  provenance: z.object({
    source: z.string().min(1).max(60),
    origin: z.enum(["real", "mock"]),
    fetchedAt: z.string().datetime(),
  }).strict(),
}).strict();

export interface ValidationIssue {
  level: "error" | "warning";
  /** e.g. "annual 2026-03-31 balance" */
  where: string;
  message: string;
}

export interface FundamentalsValidation {
  valid: boolean;
  /** Parsed data with periods sorted newest first; null when the shape is invalid. */
  data: CompanyFundamentals | null;
  issues: ValidationIssue[];
}

const differsByMoreThan = (a: number, b: number, fraction: number) => Math.abs(a - b) > Math.abs(b) * fraction;

function checkSet(set: FinancialStatementSet, today: string, issues: ValidationIssue[]): void {
  const p = set.period;
  const where = `${p.type} ${p.periodEnd}`;
  const err = (message: string, part = "") => issues.push({ level: "error", where: `${where}${part}`, message });
  const warn = (message: string, part = "") => issues.push({ level: "warning", where: `${where}${part}`, message });

  if (p.periodEnd < p.periodStart) err("period ends before it starts");
  if (p.periodEnd > today) err("period ends in the future");
  if (p.filedAt && p.filedAt < p.periodEnd) err("results filed before the period ended");
  if (p.type === "annual" && p.fiscalQuarter !== null) err("annual period must not have a fiscal quarter");
  if (p.type === "quarterly" && p.fiscalQuarter === null) err("quarterly period needs a fiscal quarter");

  const i = set.income;
  if (i) {
    for (const k of ["sharesBasic", "sharesDiluted"] as const) if (i[k] !== null && i[k] <= 0) err(`${k} must be positive`, " income");
    if (i.revenue !== null && i.revenue < 0) warn("negative revenue", " income");
    if (i.revenue !== null && i.costOfRevenue !== null && i.grossProfit !== null && differsByMoreThan(i.revenue - i.costOfRevenue, i.grossProfit, 0.01)) {
      warn("gross profit ≠ revenue − cost of revenue (more than 1% apart)", " income");
    }
  }
  const b = set.balance;
  if (b) {
    if (b.sharesOutstanding !== null && b.sharesOutstanding <= 0) err("sharesOutstanding must be positive", " balance");
    if (b.totalAssets !== null && b.totalLiabilities !== null && b.totalEquity !== null && differsByMoreThan(b.totalLiabilities + b.totalEquity, b.totalAssets, 0.01)) {
      warn("total assets ≠ liabilities + equity (more than 1% apart)", " balance");
    }
  }
}

export function validateFundamentals(input: unknown, options: { expectedCurrency: string; now?: Date }): FundamentalsValidation {
  const parsed = companyFundamentalsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      data: null,
      issues: parsed.error.issues.slice(0, 10).map((e) => ({ level: "error", where: e.path.join(".") || "root", message: e.message })),
    };
  }
  const data = parsed.data as CompanyFundamentals;
  const issues: ValidationIssue[] = [];
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);

  if (data.currency !== options.expectedCurrency.toUpperCase()) {
    issues.push({ level: "error", where: "currency", message: `reported in ${data.currency}, instrument is quoted in ${options.expectedCurrency}` });
  }
  for (const [label, sets, type] of [["annual", data.annual, "annual"], ["quarterly", data.quarterly, "quarterly"]] as const) {
    const seen = new Set<string>();
    for (const s of sets) {
      if (s.period.type !== type) issues.push({ level: "error", where: `${label} ${s.period.periodEnd}`, message: `listed under ${label} but typed ${s.period.type}` });
      if (seen.has(s.period.periodEnd)) issues.push({ level: "error", where: `${label} ${s.period.periodEnd}`, message: "duplicate period" });
      seen.add(s.period.periodEnd);
      checkSet(s, today, issues);
    }
  }

  const byNewest = (a: FinancialStatementSet, b: FinancialStatementSet) => (a.period.periodEnd < b.period.periodEnd ? 1 : -1);
  const sorted: CompanyFundamentals = { ...data, annual: [...data.annual].sort(byNewest), quarterly: [...data.quarterly].sort(byNewest) };
  return { valid: !issues.some((x) => x.level === "error"), data: sorted, issues };
}
