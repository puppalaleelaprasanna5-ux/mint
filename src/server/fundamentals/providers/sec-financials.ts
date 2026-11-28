/**
 * SEC financial statements adapter: XBRL CompanyFacts (US GAAP) → Mint's statement structures.
 *
 * Source: https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 * ("returns all the company concepts data for a company into a single API call", SEC API docs).
 * Each fact: { start?, end, val, accn, fy, fp, form, filed, frame? }. Verified on live data
 * (Apple, 2026-11-28): `fy`/`fp` describe the FILING, not the period (comparatives in later
 * filings carry the later filing's fy/fp); 10-Qs include year-to-date durations; restated values
 * appear in later filings (e.g. split-adjusted share counts).
 *
 * Rules (nothing is estimated; a figure is either reported or null):
 * - Only facts from periodic reports (10-K, 10-Q, 20-F, 40-F and amendments) are used.
 * - Durations follow SEC's frames tolerances: annual 365 ± 30 days, quarterly 91 ± 30 days.
 *   Year-to-date (6/9-month) values are ignored, never subtracted to make quarters.
 * - Balance-sheet (instant) values are matched to a period by its end date.
 * - Same concept + period in several filings: the LATEST filed value wins, like SEC's frames API
 *   ("one fact … that is last filed"). If filings on that same latest date disagree, the figure is
 *   null and noted; when they agree, an amendment is the filing cited as the source.
 * - Fiscal year/quarter labels come from the ORIGINAL (earliest) filing of the period, and only
 *   if it was filed within 150 days of the period end; otherwise the period is skipped.
 * - Cash PAYMENT concepts (capex, dividends, buybacks) are reported as positive amounts; Mint
 *   stores outflows as negative, so their sign is flipped. No other transformation.
 */
import { z } from "zod";
import { classifyFilingForm } from "@/lib/fundamentals/company";
import type {
  BalanceSheet,
  CashFlowStatement,
  CompanyFundamentals,
  FinancialStatementSet,
  FundamentalsInstrumentRef,
  IncomeStatement,
  SourceFiling,
} from "@/lib/fundamentals/types";
import { FundamentalsError, type FundamentalsMissing, type FundamentalsProvider, type FundamentalsProviderStatus } from "../provider";
import type { SecEdgarProvider } from "./sec-edgar";

export const SEC_FINANCIALS_SOURCE = "sec-edgar-xbrl";

// ───────────────────────────── Concept mappings ─────────────────────────────

type UnitKind = "money" | "perShare" | "shares";
export interface ConceptSpec {
  /** US GAAP concepts in priority order; the first one reported for a period is used. */
  concepts: string[];
  unit: UnitKind;
  /** −1 flips SEC's positive "payments" into Mint's negative-outflow convention. */
  sign?: 1 | -1;
}

/** Income statement: duration facts. */
export const INCOME_CONCEPTS: Record<keyof IncomeStatement, ConceptSpec> = {
  revenue: {
    concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
    unit: "money",
  },
  costOfRevenue: { concepts: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"], unit: "money" },
  grossProfit: { concepts: ["GrossProfit"], unit: "money" },
  operatingExpenses: { concepts: ["OperatingExpenses"], unit: "money" },
  operatingIncome: { concepts: ["OperatingIncomeLoss"], unit: "money" },
  interestExpense: { concepts: ["InterestExpense", "InterestExpenseNonoperating"], unit: "money" },
  pretaxIncome: {
    concepts: [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
    unit: "money",
  },
  incomeTax: { concepts: ["IncomeTaxExpenseBenefit"], unit: "money" },
  netIncome: { concepts: ["NetIncomeLoss"], unit: "money" },
  epsBasic: { concepts: ["EarningsPerShareBasic"], unit: "perShare" },
  epsDiluted: { concepts: ["EarningsPerShareDiluted"], unit: "perShare" },
  sharesBasic: { concepts: ["WeightedAverageNumberOfSharesOutstandingBasic"], unit: "shares" },
  sharesDiluted: { concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
};

/** Balance sheet: instant facts at the period end. */
export const BALANCE_CONCEPTS: Record<keyof BalanceSheet, ConceptSpec> = {
  cashAndEquivalents: { concepts: ["CashAndCashEquivalentsAtCarryingValue"], unit: "money" },
  shortTermInvestments: { concepts: ["ShortTermInvestments", "MarketableSecuritiesCurrent"], unit: "money" },
  totalCurrentAssets: { concepts: ["AssetsCurrent"], unit: "money" },
  totalAssets: { concepts: ["Assets"], unit: "money" },
  totalCurrentLiabilities: { concepts: ["LiabilitiesCurrent"], unit: "money" },
  /** No single US GAAP concept reports total debt; summing components would be Mint's own estimate. */
  totalDebt: { concepts: [], unit: "money" },
  totalLiabilities: { concepts: ["Liabilities"], unit: "money" },
  /** Total equity incl. non-controlling interests when reported (matches assets = liabilities + equity). */
  totalEquity: { concepts: ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "StockholdersEquity"], unit: "money" },
  sharesOutstanding: { concepts: ["CommonStockSharesOutstanding"], unit: "shares" },
};

/** Cash-flow statement: duration facts. */
export const CASH_FLOW_CONCEPTS: Record<keyof CashFlowStatement, ConceptSpec> = {
  operatingCashFlow: { concepts: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], unit: "money" },
  capitalExpenditure: { concepts: ["PaymentsToAcquirePropertyPlantAndEquipment"], unit: "money", sign: -1 },
  investingCashFlow: { concepts: ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"], unit: "money" },
  financingCashFlow: { concepts: ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"], unit: "money" },
  dividendsPaid: { concepts: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], unit: "money", sign: -1 },
  shareRepurchases: { concepts: ["PaymentsForRepurchaseOfCommonStock"], unit: "money", sign: -1 },
};

// ───────────────────────────── Parsing ─────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const factSchema = z.object({
  start: z.string().regex(DATE).optional(),
  end: z.string().regex(DATE),
  val: z.number().finite(),
  accn: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  fy: z.number().int().nullable().optional(),
  fp: z.string().nullable().optional(),
  form: z.string(),
  filed: z.string().regex(DATE),
});
type Fact = z.infer<typeof factSchema>;
const conceptSchema = z.object({ units: z.record(z.string(), z.array(factSchema)) });
const companyFactsSchema = z.object({
  cik: z.union([z.number(), z.string()]),
  entityName: z.string().optional(),
  facts: z.record(z.string(), z.record(z.string(), z.unknown())),
});

/** SEC frames tolerances: annual 365 ± 30 days, quarterly 91 ± 30 days. */
const ANNUAL_DAYS = [335, 395] as const;
const QUARTER_DAYS = [61, 121] as const;
/** A period's own (original) filing arrives within this many days of its end; comparatives come later. */
const ORIGINAL_FILING_WINDOW_DAYS = 150;

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

type PeriodKind = "annual" | "quarterly";
function durationKind(f: Fact): PeriodKind | null {
  if (!f.start) return null;
  const d = daysBetween(f.start, f.end);
  if (d >= ANNUAL_DAYS[0] && d <= ANNUAL_DAYS[1]) return "annual";
  if (d >= QUARTER_DAYS[0] && d <= QUARTER_DAYS[1]) return "quarterly";
  return null; // year-to-date or other durations: not used
}

/** Latest filed first; on the same date an amendment first; then the later accession. */
function newerFirst(a: Fact, b: Fact): number {
  if (a.filed !== b.filed) return a.filed < b.filed ? 1 : -1;
  const aa = a.form.endsWith("/A") ? 1 : 0;
  const ba = b.form.endsWith("/A") ? 1 : 0;
  if (aa !== ba) return ba - aa;
  return a.accn < b.accn ? 1 : a.accn > b.accn ? -1 : 0;
}

interface Picked {
  value: number | null; // null when filings disagree
  fact: Fact;
}

export interface NormalizeOptions {
  symbol: string;
  market: string;
  /** "MM-DD" from SEC submissions, if known. */
  fiscalYearEnd: string | null;
  fetchedAt: string;
  maxAnnual?: number;
  maxQuarterly?: number;
}

export const STANDARD_NOTES = [
  "Total debt is not reported as one US GAAP figure, so it is left empty rather than added up from parts.",
  "10-Q cash flows are year-to-date; only true 3-month figures are shown (usually Q1). Other quarters' cash flows are left empty.",
  "Fourth quarters are not filed separately; they are not derived by subtracting.",
  "Each figure is the latest value filed for its period, including restatements (e.g. split-adjusted share counts).",
];

/**
 * Pure, deterministic mapping of a CompanyFacts payload. Throws FundamentalsError
 * ("INVALID_RESPONSE") only when the payload itself is malformed.
 */
export function normalizeCompanyFacts(raw: unknown, o: NormalizeOptions): CompanyFundamentals | FundamentalsMissing {
  const top = companyFactsSchema.safeParse(raw);
  if (!top.success) throw new FundamentalsError("INVALID_RESPONSE", "SEC financial data had an unexpected format.");
  const gaapRaw = top.data.facts["us-gaap"];
  if (!gaapRaw) {
    return {
      missing: true,
      reason: top.data.facts["ifrs-full"]
        ? "This company reports under IFRS; Mint only maps US GAAP figures so far."
        : "SEC has no US GAAP financial figures for this company.",
    };
  }

  // Parse only the concepts Mint maps (the full file has hundreds).
  const allSpecs = [...Object.values(INCOME_CONCEPTS), ...Object.values(BALANCE_CONCEPTS), ...Object.values(CASH_FLOW_CONCEPTS)];
  const wanted = new Set(allSpecs.flatMap((s) => s.concepts));
  const gaap = new Map<string, Record<string, Fact[]>>();
  for (const name of wanted) {
    if (!(name in gaapRaw)) continue;
    const parsed = conceptSchema.safeParse(gaapRaw[name]);
    if (!parsed.success) throw new FundamentalsError("INVALID_RESPONSE", `SEC financial data for ${name} had an unexpected format.`);
    gaap.set(name, parsed.data.units);
  }

  // Reporting currency: the ISO-4217 unit with the most monetary facts.
  const currencyCounts = new Map<string, number>();
  for (const spec of allSpecs.filter((s) => s.unit === "money")) {
    for (const c of spec.concepts) {
      for (const [unit, facts] of Object.entries(gaap.get(c) ?? {})) {
        if (/^[A-Z]{3}$/.test(unit)) currencyCounts.set(unit, (currencyCounts.get(unit) ?? 0) + facts.length);
      }
    }
  }
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!currency) return { missing: true, reason: "SEC has no monetary US GAAP figures Mint can map for this company." };
  const unitKey = (u: UnitKind) => (u === "money" ? currency : u === "perShare" ? `${currency}/shares` : "shares");

  const eligible = (concept: string, unit: UnitKind) => (gaap.get(concept)?.[unitKey(unit)] ?? []).filter((f) => classifyFilingForm(f.form) !== null);

  let ambiguous = 0;
  /** periodKey → picked fact, using the first concept (by priority) that reports the period. */
  function pick(spec: ConceptSpec, instant: boolean): Map<string, Picked> {
    const out = new Map<string, Picked>();
    for (const concept of spec.concepts) {
      const groups = new Map<string, Fact[]>();
      for (const f of eligible(concept, spec.unit)) {
        if (instant ? f.start !== undefined : durationKind(f) === null) continue;
        const key = instant ? f.end : `${f.start}|${f.end}`;
        if (out.has(key)) continue; // a higher-priority concept already reports this period
        const g = groups.get(key);
        if (g) g.push(f);
        else groups.set(key, [f]);
      }
      for (const [key, facts] of groups) {
        facts.sort(newerFirst);
        const top = facts[0];
        const sameDay = facts.filter((f) => f.filed === top.filed);
        const disagree = new Set(sameDay.map((f) => f.val)).size > 1;
        if (disagree) ambiguous++;
        out.set(key, { value: disagree ? null : top.val * (spec.sign ?? 1), fact: top });
      }
    }
    return out;
  }

  const pickAll = <K extends string>(map: Record<K, ConceptSpec>, instant: boolean) =>
    Object.fromEntries(Object.entries(map).map(([field, spec]) => [field, pick(spec as ConceptSpec, instant)])) as Record<K, Map<string, Picked>>;
  const income = pickAll(INCOME_CONCEPTS, false);
  const balance = pickAll(BALANCE_CONCEPTS, true);
  const cash = pickAll(CASH_FLOW_CONCEPTS, false);

  // Original (earliest-filed) fact for every duration period, across all mapped concepts.
  const original = new Map<string, Fact>();
  for (const spec of [...Object.values(INCOME_CONCEPTS), ...Object.values(CASH_FLOW_CONCEPTS)]) {
    for (const c of spec.concepts) {
      for (const f of eligible(c, spec.unit)) {
        if (durationKind(f) === null) continue;
        const key = `${f.start}|${f.end}`;
        const cur = original.get(key);
        if (!cur || f.filed < cur.filed || (f.filed === cur.filed && f.accn < cur.accn)) original.set(key, f);
      }
    }
  }

  let unlabelled = 0;
  const candidates: { key: string; kind: PeriodKind; start: string; end: string; fy: number; quarter: 1 | 2 | 3 | 4 | null; filedAt: string }[] = [];
  for (const [key, f] of original) {
    const kind = durationKind(f) as PeriodKind;
    const fresh = daysBetween(f.end, f.filed) <= ORIGINAL_FILING_WINDOW_DAYS;
    const fp = (f.fp ?? "").toUpperCase();
    const quarter = /^Q[1-4]$/.test(fp) ? (Number(fp[1]) as 1 | 2 | 3 | 4) : null;
    const labelOk = typeof f.fy === "number" && fresh && (kind === "annual" ? fp === "FY" : quarter !== null);
    if (!labelOk) {
      unlabelled++;
      continue;
    }
    candidates.push({ key, kind, start: f.start as string, end: f.end, fy: f.fy as number, quarter: kind === "annual" ? null : quarter, filedAt: f.filed });
  }

  const statementFor = <K extends string>(maps: Record<K, Map<string, Picked>>, key: string, used: Fact[]) => {
    let any = false;
    const stmt = {} as Record<K, number | null>;
    for (const field of Object.keys(maps) as K[]) {
      const p = maps[field].get(key);
      stmt[field] = p ? p.value : null;
      if (p && p.value !== null) {
        any = true;
        used.push(p.fact);
      }
    }
    return any ? stmt : null;
  };

  const build = (kind: PeriodKind, max: number): FinancialStatementSet[] => {
    // One period per end date (keep the one with more reported figures).
    const byEnd = new Map<string, { c: (typeof candidates)[number]; set: FinancialStatementSet; count: number }>();
    for (const c of candidates.filter((x) => x.kind === kind)) {
      const used: Fact[] = [];
      const inc = statementFor(income, c.key, used) as IncomeStatement | null;
      const cf = statementFor(cash, c.key, used) as CashFlowStatement | null;
      const bal = statementFor(balance, c.end, used) as BalanceSheet | null;
      const sources = new Map<string, SourceFiling>();
      for (const f of used) sources.set(f.accn, { accessionNumber: f.accn, form: f.form, filedAt: f.filed });
      const set: FinancialStatementSet = {
        period: { type: kind, fiscalYear: c.fy, fiscalQuarter: c.quarter, periodStart: c.start, periodEnd: c.end, filedAt: c.filedAt },
        income: inc,
        balance: bal,
        cashFlow: cf,
        sources: [...sources.values()].sort((a, b) => (a.filedAt < b.filedAt ? -1 : a.filedAt > b.filedAt ? 1 : 0)).slice(0, 20),
      };
      const prev = byEnd.get(c.end);
      if (!prev || used.length > prev.count) byEnd.set(c.end, { c, set, count: used.length });
    }
    return [...byEnd.values()]
      .filter((x) => x.count > 0)
      .map((x) => x.set)
      .sort((a, b) => (a.period.periodEnd < b.period.periodEnd ? 1 : -1))
      .slice(0, max);
  };

  const annual = build("annual", o.maxAnnual ?? 5);
  const quarterly = build("quarterly", o.maxQuarterly ?? 12);
  if (annual.length === 0 && quarterly.length === 0) {
    return { missing: true, reason: "SEC has no 10-K/10-Q financial figures Mint can map for this company." };
  }
  const fiscalYearEnd = o.fiscalYearEnd ?? annual[0]?.period.periodEnd.slice(5) ?? null;
  if (!fiscalYearEnd) return { missing: true, reason: "The company's fiscal year end is unknown, so its periods cannot be labelled." };

  const notes = [...STANDARD_NOTES];
  if (unlabelled) notes.push(`${unlabelled} reporting periods were skipped because their original filing could not be identified.`);
  if (ambiguous) notes.push(`${ambiguous} figures were left empty because filings on the same date reported different values.`);

  return {
    symbol: o.symbol,
    market: o.market,
    currency,
    fiscalYearEnd,
    annual,
    quarterly,
    provenance: { source: SEC_FINANCIALS_SOURCE, origin: "real", fetchedAt: o.fetchedAt },
    notes,
  };
}

// ───────────────────────────── Provider ─────────────────────────────

type CacheValue = CompanyFundamentals | FundamentalsMissing;
const cache = new Map<string, { expiresAt: number; value: CacheValue }>();
const inflight = new Map<string, Promise<CacheValue>>();

/** For tests. */
export function resetSecFinancialsCache(): void {
  cache.clear();
  inflight.clear();
}

export class SecFinancialsProvider implements FundamentalsProvider {
  readonly id = SEC_FINANCIALS_SOURCE;
  readonly name = "SEC EDGAR financial statements";
  readonly origin = "real" as const;

  constructor(
    private readonly sec: SecEdgarProvider,
    private readonly options: { now?: () => number; ttlMs?: number; maxCached?: number } = {},
  ) {}

  status(): FundamentalsProviderStatus {
    const s = this.sec.status();
    return {
      id: this.id,
      name: this.name,
      origin: "real",
      configured: s.configured,
      missingEnv: s.missingEnv,
      notes: ["US GAAP figures from SEC XBRL filings (10-K/10-Q) for NASDAQ/NYSE companies.", ...STANDARD_NOTES],
    };
  }

  supports(ref: FundamentalsInstrumentRef): boolean {
    return this.sec.supports(ref);
  }

  async fetchFundamentals(ref: FundamentalsInstrumentRef, { signal }: { signal: AbortSignal }): Promise<CompanyFundamentals | FundamentalsMissing | null> {
    const now = this.options.now ?? Date.now;
    const match = await this.sec.lookup(ref, { signal });
    if (!match) return { missing: true, reason: `SEC has no company for ticker ${ref.symbol}.` };
    const cik = match.identity.identifiers.cik as string;
    const key = `${cik}|${ref.symbol}|${ref.market}`;

    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;
    let pending = inflight.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const raw = await this.sec.fetchCompanyFacts(cik, { signal });
          const value: CacheValue =
            raw === null
              ? { missing: true, reason: `SEC has no XBRL financial data for ${match.identity.name}.` }
              : normalizeCompanyFacts(raw, {
                  symbol: ref.symbol,
                  market: ref.market,
                  fiscalYearEnd: match.identity.fiscalYearEnd,
                  fetchedAt: new Date(now()).toISOString(),
                });
          cache.delete(key);
          cache.set(key, { expiresAt: now() + (this.options.ttlMs ?? 3_600_000), value });
          while (cache.size > (this.options.maxCached ?? 50)) cache.delete(cache.keys().next().value as string);
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, pending);
    }
    return pending;
  }
}
