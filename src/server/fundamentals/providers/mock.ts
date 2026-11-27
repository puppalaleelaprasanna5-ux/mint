/**
 * Deterministic MOCK fundamentals for the demo universe. For development and tests only: the
 * figures are generated from a seeded PRNG and are NOT any company's real results. Every result
 * is labelled origin "mock".
 *
 * Generated statements are internally consistent (gross profit = revenue − cost, assets =
 * liabilities + equity, a year's quarters match its annual revenue within rounding) so validation and
 * future ratio calculations behave as they would on real data.
 */
import { hashSeed, mulberry32 } from "@/lib/demo/prng";
import { DEMO_INSTRUMENTS } from "@/lib/demo/universe";
import type {
  BalanceSheet,
  CashFlowStatement,
  CompanyFundamentals,
  FinancialStatementSet,
  FiscalPeriod,
  FundamentalsInstrumentRef,
  IncomeStatement,
} from "@/lib/fundamentals/types";
import { FUNDAMENTALS_MARKETS } from "@/lib/fundamentals/types";
import type { FundamentalsProvider, FundamentalsProviderStatus } from "../provider";

export const MOCK_FUNDAMENTALS_SOURCE = "mint-mock-fundamentals";

export interface MockFundamentalsOptions {
  /** Generate the statements a company would have published by this date. Default: now. */
  asOf?: () => Date;
  /** Drop some figures, to exercise "partial" data handling. */
  omitSomeFields?: boolean;
  annualYears?: number;
  quarters?: number;
}

const FILING_LAG_DAYS = { annual: 60, quarterly: 45 };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDaysIso = (s: string, days: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + days * 86_400_000));
/** Last day of calendar month `month` (1–12; 0 or 13 roll into the adjacent year). */
function monthEnd(year: number, month: number): string {
  return iso(new Date(Date.UTC(year, month, 0)));
}

interface Profile {
  annualRevenue: number; // latest full year, base currency units
  growth: number;
  grossMargin: number;
  opMargin: number;
  shares: number;
  debtRatio: number; // debt / assets
}

function profileFor(symbol: string, currency: string): Profile {
  const r = mulberry32(hashSeed(`fundamentals:${symbol}`));
  const scale = currency === "INR" ? 1e12 : 1e11; // ~₹1 lakh crore / ~$100bn order of magnitude
  return {
    annualRevenue: Math.round(scale * (0.3 + r() * 2.5)),
    growth: 0.03 + r() * 0.15,
    grossMargin: 0.3 + r() * 0.35,
    opMargin: 0.1 + r() * 0.2,
    shares: Math.round((currency === "INR" ? 3e9 : 4e9) * (0.5 + r() * 2)),
    debtRatio: 0.05 + r() * 0.3,
  };
}

function income(revenue: number, p: Profile, sharesOut: number): IncomeStatement {
  const cost = Math.round(revenue * (1 - p.grossMargin));
  const gross = revenue - cost;
  const opex = Math.round(revenue * (p.grossMargin - p.opMargin));
  const operating = gross - opex;
  const interest = Math.round(revenue * 0.01);
  const pretax = operating - interest;
  const tax = Math.round(pretax * 0.25);
  const net = pretax - tax;
  return {
    revenue,
    costOfRevenue: cost,
    grossProfit: gross,
    operatingExpenses: opex,
    operatingIncome: operating,
    interestExpense: interest,
    pretaxIncome: pretax,
    incomeTax: tax,
    netIncome: net,
    epsBasic: Math.round((net / sharesOut) * 100) / 100,
    epsDiluted: Math.round((net / (sharesOut * 1.01)) * 100) / 100,
    sharesBasic: sharesOut,
    sharesDiluted: Math.round(sharesOut * 1.01),
  };
}

function balance(annualRevenue: number, p: Profile, sharesOut: number): BalanceSheet {
  const assets = Math.round(annualRevenue * 1.4);
  const liabilities = Math.round(assets * (0.35 + p.debtRatio));
  return {
    cashAndEquivalents: Math.round(assets * 0.08),
    shortTermInvestments: Math.round(assets * 0.05),
    totalCurrentAssets: Math.round(assets * 0.35),
    totalAssets: assets,
    totalCurrentLiabilities: Math.round(liabilities * 0.4),
    totalDebt: Math.round(assets * p.debtRatio),
    totalLiabilities: liabilities,
    totalEquity: assets - liabilities,
    sharesOutstanding: sharesOut,
  };
}

function cashFlow(inc: IncomeStatement, revenue: number): CashFlowStatement {
  const net = inc.netIncome as number;
  return {
    operatingCashFlow: Math.round(net * 1.2),
    capitalExpenditure: -Math.round(revenue * 0.06),
    investingCashFlow: -Math.round(revenue * 0.08),
    financingCashFlow: -Math.round(net * 0.5),
    dividendsPaid: -Math.round(net * 0.3),
    shareRepurchases: -Math.round(net * 0.1),
  };
}

function withGaps<T extends object>(stmt: T, keys: (keyof T)[]): T {
  const copy = { ...stmt };
  for (const k of keys) (copy as Record<keyof T, unknown>)[k] = null;
  return copy;
}

export class MockFundamentalsProvider implements FundamentalsProvider {
  readonly id = MOCK_FUNDAMENTALS_SOURCE;
  readonly name = "Mock fundamentals (development)";
  readonly origin = "mock" as const;
  private readonly asOf: () => Date;

  constructor(private readonly options: MockFundamentalsOptions = {}) {
    this.asOf = options.asOf ?? (() => new Date());
  }

  status(): FundamentalsProviderStatus {
    return {
      id: this.id,
      name: this.name,
      origin: "mock",
      configured: true,
      missingEnv: [],
      notes: ["Deterministic generated figures for the demo companies. NOT real financial results."],
    };
  }

  supports(ref: FundamentalsInstrumentRef): boolean {
    return ref.type === "EQUITY" && (FUNDAMENTALS_MARKETS as readonly string[]).includes(ref.market);
  }

  async fetchFundamentals(ref: FundamentalsInstrumentRef): Promise<CompanyFundamentals | null> {
    const known = DEMO_INSTRUMENTS.find((i) => i.symbol === ref.symbol && i.market === ref.market && i.type === "EQUITY");
    if (!known || !this.supports(ref)) return null;

    const india = ref.market === "NSE" || ref.market === "BSE";
    const fyEndMonth = india ? 3 : 12; // Indian companies mostly report Apr–Mar; US demo companies Jan–Dec
    const asOf = this.asOf();
    const p = profileFor(ref.symbol, ref.currency);
    const annualYears = this.options.annualYears ?? 4;
    const quarters = this.options.quarters ?? 8;

    // Latest fiscal year whose annual results would be published by `asOf`.
    let fy = asOf.getUTCFullYear() + 1;
    while (addDaysIso(monthEnd(fy, fyEndMonth), FILING_LAG_DAYS.annual) > iso(asOf)) fy--;

    const annual: FinancialStatementSet[] = [];
    for (let k = 0; k < annualYears; k++) {
      const year = fy - k;
      const revenue = Math.round(p.annualRevenue / (1 + p.growth) ** k);
      const periodEnd = monthEnd(year, fyEndMonth);
      const period: FiscalPeriod = {
        type: "annual",
        fiscalYear: year,
        fiscalQuarter: null,
        periodStart: addDaysIso(monthEnd(year - 1, fyEndMonth), 1),
        periodEnd,
        filedAt: addDaysIso(periodEnd, FILING_LAG_DAYS.annual),
      };
      const inc = income(revenue, p, p.shares);
      annual.push({ period, income: inc, balance: balance(revenue, p, p.shares), cashFlow: cashFlow(inc, revenue) });
    }

    // Quarters: walk back from the latest quarter-end published by `asOf`.
    const quarterly: FinancialStatementSet[] = [];
    let end = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0));
    // Quarter ends are Mar/Jun/Sep/Dec for both fiscal calendars used here (FY ending Mar or Dec).
    while (end.getUTCMonth() % 3 !== 2) end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0));
    while (addDaysIso(iso(end), FILING_LAG_DAYS.quarterly) > iso(asOf)) end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 0));
    for (let k = 0; k < quarters; k++) {
      const qEnd = iso(end);
      const month = end.getUTCMonth() + 1; // 3, 6, 9, 12
      const quarterOfFy = (((month - fyEndMonth + 12) % 12) / 3) || 4;
      const fiscalYear = month <= fyEndMonth ? end.getUTCFullYear() : end.getUTCFullYear() + 1;
      const yearsBack = fy - fiscalYear;
      const yearRevenue = p.annualRevenue / (1 + p.growth) ** yearsBack;
      const revenue = Math.round(yearRevenue / 4);
      const period: FiscalPeriod = {
        type: "quarterly",
        fiscalYear,
        fiscalQuarter: quarterOfFy as 1 | 2 | 3 | 4,
        periodStart: addDaysIso(monthEnd(end.getUTCFullYear(), month - 3), 1),
        periodEnd: qEnd,
        filedAt: addDaysIso(qEnd, FILING_LAG_DAYS.quarterly),
      };
      let inc = income(revenue, p, p.shares);
      let bal: BalanceSheet | null = balance(Math.round(yearRevenue), p, p.shares);
      let cf: CashFlowStatement | null = cashFlow(inc, revenue);
      if (this.options.omitSomeFields && k % 2 === 1) {
        inc = withGaps(inc, ["interestExpense", "epsDiluted", "sharesDiluted"]);
        bal = withGaps(bal, ["shortTermInvestments"]);
        cf = k % 4 === 3 ? null : withGaps(cf, ["shareRepurchases"]);
      }
      quarterly.push({ period, income: inc, balance: bal, cashFlow: cf });
      end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 0));
    }

    return {
      symbol: ref.symbol,
      market: ref.market,
      currency: ref.currency,
      fiscalYearEnd: india ? "03-31" : "12-31",
      annual,
      quarterly,
      provenance: { source: MOCK_FUNDAMENTALS_SOURCE, origin: "mock", fetchedAt: asOf.toISOString() },
    };
  }
}
