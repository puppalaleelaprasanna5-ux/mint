import { describe, expect, it } from "vitest";
import { validateFundamentals } from "./validate";
import { assessCompleteness, assessFreshness, describeFundamentals, fundamentalsLabel, STALE_AFTER_DAYS } from "./status";
import type { CompanyFundamentals, FinancialStatementSet } from "./types";

const NOW = new Date("2026-11-27T12:00:00Z");

/** Start of a period ending `end`: the day after the same date 12 (annual) or 3 (quarterly) months earlier. */
function startFor(type: "annual" | "quarterly", end: string): string {
  const d = new Date(`${end}T00:00:00Z`);
  const back = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (type === "annual" ? 12 : 3) + 1, 0)); // previous period's month end
  return new Date(back.getTime() + 86_400_000).toISOString().slice(0, 10);
}

function set(type: "annual" | "quarterly", periodEnd: string, overrides: Partial<FinancialStatementSet> = {}): FinancialStatementSet {
  return {
    period: { type, fiscalYear: Number(periodEnd.slice(0, 4)), fiscalQuarter: type === "annual" ? null : 2, periodStart: startFor(type, periodEnd), periodEnd, filedAt: null },
    income: {
      revenue: 1000, costOfRevenue: 600, grossProfit: 400, operatingExpenses: 200, operatingIncome: 200, interestExpense: 10,
      pretaxIncome: 190, incomeTax: 50, netIncome: 140, epsBasic: 1.4, epsDiluted: 1.38, sharesBasic: 100, sharesDiluted: 101,
    },
    balance: {
      cashAndEquivalents: 50, shortTermInvestments: 20, totalCurrentAssets: 300, totalAssets: 2000, totalCurrentLiabilities: 250,
      totalDebt: 400, totalLiabilities: 1200, totalEquity: 800, sharesOutstanding: 100,
    },
    cashFlow: { operatingCashFlow: 170, capitalExpenditure: -60, investingCashFlow: -80, financingCashFlow: -70, dividendsPaid: -40, shareRepurchases: -10 },
    ...overrides,
  };
}

function company(overrides: Partial<CompanyFundamentals> = {}): CompanyFundamentals {
  return {
    symbol: "TCS",
    market: "NSE",
    currency: "INR",
    fiscalYearEnd: "03-31",
    annual: [set("annual", "2025-03-31"), set("annual", "2026-03-31")],
    quarterly: [set("quarterly", "2026-09-30")],
    provenance: { source: "test", origin: "real", fetchedAt: NOW.toISOString() },
    ...overrides,
  };
}
const validate = (input: unknown, currency = "INR") => validateFundamentals(input, { expectedCurrency: currency, now: NOW });

describe("validateFundamentals", () => {
  it("accepts consistent data and sorts periods newest first", () => {
    const v = validate(company());
    expect(v).toMatchObject({ valid: true, issues: [] });
    expect(v.data?.annual.map((s) => s.period.periodEnd)).toEqual(["2026-03-31", "2025-03-31"]);
  });

  it("keeps null figures as null (never filled in)", () => {
    const c = company({ quarterly: [set("quarterly", "2026-09-30", { income: { ...set("quarterly", "2026-09-30").income!, revenue: null } })] });
    const v = validate(c);
    expect(v.valid).toBe(true);
    expect(v.data?.quarterly[0].income?.revenue).toBeNull();
  });

  it.each([
    ["NaN amount", (c: CompanyFundamentals) => ((c.annual[0].income as unknown as Record<string, unknown>).revenue = Number.NaN)],
    ["string amount", (c: CompanyFundamentals) => ((c.annual[0].income as unknown as Record<string, unknown>).revenue = "1000")],
    ["unknown field", (c: CompanyFundamentals) => ((c.annual[0].income as unknown as Record<string, unknown>).ebitdaGuess = 5)],
    ["bad date", (c: CompanyFundamentals) => (c.annual[0].period.periodEnd = "31/03/2026")],
    ["lower-case currency", (c: CompanyFundamentals) => (c.currency = "inr")],
    ["missing provenance", (c: CompanyFundamentals) => delete (c as Partial<CompanyFundamentals>).provenance],
    ["invalid origin", (c: CompanyFundamentals) => ((c.provenance as unknown as Record<string, unknown>).origin = "estimated")],
  ])("rejects malformed shape: %s", (_label, mutate) => {
    const c = structuredClone(company());
    mutate(c);
    const v = validate(c);
    expect(v.valid).toBe(false);
    expect(v.data).toBeNull();
  });

  it.each([
    ["currency mismatch", company(), "USD", /reported in INR/],
    ["duplicate period", company({ annual: [set("annual", "2026-03-31"), set("annual", "2026-03-31")] }), "INR", /duplicate/],
    ["future period", company({ quarterly: [set("quarterly", "2026-12-31")] }), "INR", /future/],
    ["filed before period end", company({ quarterly: [set("quarterly", "2026-09-30", { period: { ...set("quarterly", "2026-09-30").period, filedAt: "2026-09-01" } })] }), "INR", /filed before/],
    ["annual with a quarter", company({ annual: [set("annual", "2026-03-31", { period: { ...set("annual", "2026-03-31").period, fiscalQuarter: 4 } })] }), "INR", /must not have a fiscal quarter/],
    ["quarterly without a quarter", company({ quarterly: [set("quarterly", "2026-09-30", { period: { ...set("quarterly", "2026-09-30").period, fiscalQuarter: null } })] }), "INR", /needs a fiscal quarter/],
    ["period type mismatch", company({ annual: [set("quarterly", "2026-09-30")] }), "INR", /listed under annual/],
    ["non-positive shares", company({ annual: [set("annual", "2026-03-31", { balance: { ...set("annual", "2026-03-31").balance!, sharesOutstanding: 0 } })] }), "INR", /sharesOutstanding must be positive/],
  ])("rejects semantically invalid data: %s", (_label, c, currency, message) => {
    const v = validate(c, currency);
    expect(v.valid).toBe(false);
    expect(v.issues.find((i) => i.level === "error")?.message).toMatch(message);
  });

  it("accepts source filings and notes, and rejects malformed accession numbers", () => {
    const withSources = (accessionNumber: string) =>
      company({ annual: [{ ...set("annual", "2026-03-31"), sources: [{ accessionNumber, form: "10-K", filedAt: "2026-05-01" }] }], notes: ["Total debt is not reported."] });
    expect(validate(withSources("0000320193-26-000026"))).toMatchObject({ valid: true, issues: [] });
    expect(validate(withSources("dddddddddd-dd-dddddd")).valid).toBe(false);
    expect(validate(withSources("320193-26-26")).valid).toBe(false);
  });

  it("warns (but keeps data) when accounting identities don't add up", () => {
    const base = set("annual", "2026-03-31");
    const c = company({
      annual: [{ ...base, income: { ...base.income!, grossProfit: 500, revenue: -5 }, balance: { ...base.balance!, totalEquity: 500 } }],
    });
    const v = validate(c);
    expect(v.valid).toBe(true);
    expect(v.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/negative revenue/), expect.stringMatching(/gross profit/), expect.stringMatching(/assets ≠ liabilities \+ equity/)]),
    );
  });
});

describe("freshness", () => {
  const withLatest = (type: "annual" | "quarterly", end: string) =>
    company(type === "annual" ? { annual: [set("annual", end)], quarterly: [] } : { annual: [], quarterly: [set("quarterly", end)] });
  const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);

  it("quarterly data is stale after 166 days", () => {
    expect(STALE_AFTER_DAYS.quarterly).toBe(166);
    expect(assessFreshness(withLatest("quarterly", daysBefore(166)), NOW).freshness).toBe("current");
    expect(assessFreshness(withLatest("quarterly", daysBefore(167)), NOW)).toMatchObject({ freshness: "stale", ageDays: 167, latestPeriodType: "quarterly" });
  });

  it("annual data is stale after 485 days", () => {
    expect(assessFreshness(withLatest("annual", daysBefore(485)), NOW).freshness).toBe("current");
    expect(assessFreshness(withLatest("annual", daysBefore(486)), NOW).freshness).toBe("stale");
  });

  it("uses the newest period of either type", () => {
    const c = company({ annual: [set("annual", "2026-03-31")], quarterly: [set("quarterly", "2025-12-31")] });
    expect(assessFreshness(c, NOW)).toMatchObject({ latestPeriodEnd: "2026-03-31", latestPeriodType: "annual", freshness: "current" });
  });

  it("is unknown with no periods", () => {
    expect(assessFreshness(company({ annual: [], quarterly: [] }), NOW)).toEqual({ freshness: "unknown", latestPeriodEnd: null, latestPeriodType: null, ageDays: null });
  });
});

describe("completeness and labels", () => {
  it("counts present vs expected figures (28 per period)", () => {
    const one = company({ annual: [set("annual", "2026-03-31")], quarterly: [] });
    expect(assessCompleteness(one)).toEqual({ completeness: "complete", ratio: 1, present: 28, expected: 28 });
    const partial = company({ annual: [set("annual", "2026-03-31", { cashFlow: null })], quarterly: [] });
    expect(assessCompleteness(partial)).toEqual({ completeness: "partial", ratio: 0.786, present: 22, expected: 28 });
    const empty = company({ annual: [set("annual", "2026-03-31", { income: null, balance: null, cashFlow: null })], quarterly: [] });
    expect(assessCompleteness(empty).completeness).toBe("empty");
  });

  it("labels origin and freshness separately and explains mock data", () => {
    expect(fundamentalsLabel("mock", "stale")).toBe("MOCK · stale");
    expect(fundamentalsLabel("real", "current")).toBe("REAL · current");
    const c = company();
    const text = describeFundamentals("mock", assessFreshness(c, NOW), assessCompleteness(c));
    expect(text).toMatch(/MOCK data/);
    expect(text).toMatch(/not the company's real results/);
  });
});
