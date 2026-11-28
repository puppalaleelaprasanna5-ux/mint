/**
 * SEC financial statements adapter tests. All HTTP is mocked. Fixtures are verbatim excerpts of
 * SEC's own responses for Apple (fetched 2026-11-28): CompanyFacts limited to the mapped concepts
 * and periods ending from 2024-09-01, plus the ticker file and submissions used by the lookup.
 * Edge cases are made by mutating COPIES of the fixture; each mutation is commented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import factsFixture from "./__fixtures__/sec-companyfacts-aapl.json";
import tickersFixture from "./__fixtures__/sec-company-tickers-exchange.json";
import aaplSubmissions from "./__fixtures__/sec-submissions-aapl.json";
import { normalizeCompanyFacts, resetSecFinancialsCache, SecFinancialsProvider, STANDARD_NOTES, type NormalizeOptions } from "./sec-financials";
import { resetSecEdgarState, SecEdgarProvider } from "./sec-edgar";
import { loadFundamentals } from "../load";
import { createFundamentalsProvider } from "../registry";
import { validateFundamentals } from "@/lib/fundamentals/validate";
import type { CompanyFundamentals, FundamentalsInstrumentRef } from "@/lib/fundamentals/types";

type Facts = typeof factsFixture;
type RawFact = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string; frame?: string };

const UA = "Mint test-suite ops@mint.test";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK0000320193.json";
const FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json";
const AAPL: FundamentalsInstrumentRef = { symbol: "AAPL", market: "NASDAQ", type: "EQUITY", currency: "USD" };
const NOW = new Date("2026-11-28T00:00:00Z");
const OPTS: NormalizeOptions = { symbol: "AAPL", market: "NASDAQ", fiscalYearEnd: "09-25", fetchedAt: NOW.toISOString() };

const normalize = (raw: unknown = factsFixture) => normalizeCompanyFacts(raw, OPTS) as CompanyFundamentals;
const copy = (): Facts => structuredClone(factsFixture);
const usd = (f: Facts, concept: string) => (f.facts["us-gaap"] as Record<string, { units: Record<string, RawFact[]> }>)[concept].units.USD;
const annual = (d: CompanyFundamentals, fy: number) => d.annual.find((s) => s.period.fiscalYear === fy)!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  resetSecEdgarState();
  resetSecFinancialsCache();
  vi.stubGlobal("fetch", () => {
    throw new Error("Real network call attempted in a test");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeCompanyFacts — verbatim Apple data", () => {
  it("maps FY2026 (10-K) exactly as SEC reports it", () => {
    const fy26 = annual(normalize(), 2026);
    expect(fy26.period).toEqual({ type: "annual", fiscalYear: 2026, fiscalQuarter: null, periodStart: "2025-09-28", periodEnd: "2026-09-26", filedAt: "2026-11-03" });
    expect(fy26.income).toMatchObject({ revenue: 478834000000, netIncome: 132175000000, epsDiluted: 8.98 });
    expect(fy26.balance).toMatchObject({ totalAssets: 404548000000, totalLiabilities: 292455000000, totalEquity: 112093000000 });
    expect(fy26.cashFlow).toMatchObject({ operatingCashFlow: 145097000000, capitalExpenditure: -9041000000 }); // payment → negative
    expect(fy26.sources).toEqual([{ accessionNumber: "0000320193-26-000026", form: "10-K", filedAt: "2026-11-03" }]);
  });

  it("labels comparative periods from their ORIGINAL filing, but uses the latest-filed values", () => {
    const fy25 = annual(normalize(), 2025);
    // FY2025 first appeared in the 10-K filed 2025-10-31 (fy 2025); the FY2026 10-K repeats it with fy 2026.
    expect(fy25.period).toMatchObject({ fiscalYear: 2025, periodStart: "2024-09-29", periodEnd: "2025-09-27", filedAt: "2025-10-31" });
    expect(fy25.income?.revenue).toBe(416161000000);
    expect(fy25.sources?.map((s) => s.accessionNumber)).toContain("0000320193-26-000026");
  });

  it("produces 3-month quarters only; year-to-date durations are ignored, not subtracted", () => {
    const d = normalize();
    const q = d.quarterly.map((s) => `${s.period.fiscalYear}Q${s.period.fiscalQuarter} ${s.period.periodStart}..${s.period.periodEnd}`);
    expect(q.slice(0, 3)).toEqual(["2026Q3 2026-03-29..2026-06-27", "2026Q2 2025-12-28..2026-03-28", "2026Q1 2025-09-28..2025-12-27"]);
    for (const s of d.quarterly) {
      const days = (Date.parse(s.period.periodEnd) - Date.parse(s.period.periodStart)) / 864e5;
      expect(days).toBeGreaterThan(80);
      expect(days).toBeLessThan(100);
    }
    // No Q4: Apple files Q4 only inside the annual 10-K.
    expect(d.quarterly.some((s) => s.period.fiscalQuarter === 4)).toBe(false);
  });

  it("fills quarterly cash flow only where a true 3-month figure exists (Q1); others stay null", () => {
    const d = normalize();
    const q1 = d.quarterly.find((s) => s.period.periodEnd === "2025-12-27")!;
    const q2 = d.quarterly.find((s) => s.period.periodEnd === "2026-03-28")!;
    expect(q1.cashFlow).toMatchObject({ operatingCashFlow: 53925000000, capitalExpenditure: -2373000000 });
    expect(q2.cashFlow).toBeNull(); // only 181-day YTD values exist
    expect(q2.income?.revenue).toBe(111184000000);
  });

  it("attaches instant balance-sheet values by period end date", () => {
    const q3 = normalize().quarterly[0];
    expect(q3.balance).toMatchObject({ totalAssets: 383266000000 });
  });

  it("leaves unreported figures null (interest expense, total debt)", () => {
    const d = normalize();
    for (const s of [...d.annual, ...d.quarterly]) {
      expect(s.income?.interestExpense ?? null).toBeNull(); // Apple stopped tagging InterestExpense after 2023
      expect(s.balance?.totalDebt ?? null).toBeNull(); // no single US GAAP total-debt concept
    }
    expect(d.notes).toEqual(STANDARD_NOTES);
  });

  it("falls back through the concept priority list (MarketableSecuritiesCurrent for short-term investments)", () => {
    expect(annual(normalize(), 2026).balance?.shortTermInvestments).toBe(usd(factsFixture, "MarketableSecuritiesCurrent").find((f) => f.end === "2026-09-26")!.val);
  });

  it("never invents a figure: every output number appears in SEC's input (sign-flipped only for payments)", () => {
    const reported = new Set<number>();
    for (const c of Object.values(factsFixture.facts["us-gaap"])) for (const arr of Object.values(c.units)) for (const f of arr as RawFact[]) {
      reported.add(f.val);
      reported.add(-f.val);
    }
    const d = normalize();
    let checked = 0;
    for (const s of [...d.annual, ...d.quarterly]) {
      for (const stmt of [s.income, s.balance, s.cashFlow]) {
        for (const v of Object.values(stmt ?? {})) {
          if (v === null) continue;
          expect(reported.has(v as number)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("passes Mint's fundamentals validation with no issues and is deterministic", () => {
    const v = validateFundamentals(normalize(), { expectedCurrency: "USD", now: NOW });
    expect(v).toMatchObject({ valid: true, issues: [] });
    expect(normalize()).toEqual(normalize());
  });
});

describe("normalizeCompanyFacts — duplicates, amendments, durations (mutated copies)", () => {
  const fy26Revenue = (f: Facts) => usd(f, "RevenueFromContractWithCustomerExcludingAssessedTax").find((x) => x.start === "2025-09-28" && x.end === "2026-09-26")!;

  it("a later amendment (10-K/A) replaces the original value; the period keeps its original filing date", () => {
    const f = copy();
    // Mutation: a 10-K/A filed later restating FY2026 revenue.
    usd(f, "RevenueFromContractWithCustomerExcludingAssessedTax").push({ ...fy26Revenue(f), val: 478000000000, accn: "0000320193-27-000001", form: "10-K/A", filed: "2027-01-15" });
    const fy26 = annual(normalize(f), 2026);
    expect(fy26.income?.revenue).toBe(478000000000);
    expect(fy26.period.filedAt).toBe("2026-11-03");
    expect(fy26.sources).toContainEqual({ accessionNumber: "0000320193-27-000001", form: "10-K/A", filedAt: "2027-01-15" });
  });

  it("two different values filed on the same date are ambiguous: left empty, not guessed (even if one is an amendment)", () => {
    const f = copy();
    const orig = fy26Revenue(f);
    // Mutation: a 10-K/A filed the same day as the 10-K, with a different value.
    usd(f, "RevenueFromContractWithCustomerExcludingAssessedTax").push({ ...orig, val: 1, accn: "0000320193-26-000099", form: "10-K/A" });
    const fy26 = annual(normalize(f), 2026);
    expect(fy26.income?.revenue).toBeNull();
    expect(normalize(f).notes?.join(" ")).toMatch(/1 figures were left empty because filings on the same date reported different values/);
  });

  it("identical duplicates are not ambiguous", () => {
    const f = copy();
    usd(f, "RevenueFromContractWithCustomerExcludingAssessedTax").push({ ...fy26Revenue(f) }); // Mutation: exact duplicate fact
    expect(annual(normalize(f), 2026).income?.revenue).toBe(478834000000);
  });

  it("ignores facts from non-periodic forms such as 8-K", () => {
    const f = copy();
    usd(f, "RevenueFromContractWithCustomerExcludingAssessedTax").push({ ...fy26Revenue(f), val: 1, accn: "0000320193-27-000002", form: "8-K", filed: "2027-02-01" }); // Mutation
    expect(annual(normalize(f), 2026).income?.revenue).toBe(478834000000);
  });

  it("does not use an instant value for a duration concept, or a duration value for a balance concept", () => {
    const f = copy();
    const { start: _s, ...instant } = fy26Revenue(f);
    void _s;
    usd(f, "RevenueFromContractWithCustomerExcludingAssessedTax").push({ ...instant, val: 1, filed: "2027-03-01", accn: "0000320193-27-000003" }); // Mutation: no start
    usd(f, "Assets").push({ start: "2025-09-28", end: "2026-09-26", val: 1, accn: "0000320193-27-000004", fy: 2026, fp: "FY", form: "10-K", filed: "2027-03-01" }); // Mutation: duration
    const fy26 = annual(normalize(f), 2026);
    expect(fy26.income?.revenue).toBe(478834000000);
    expect(fy26.balance?.totalAssets).toBe(404548000000);
  });

  it("prefers the higher-priority concept when several are reported", () => {
    const f = copy();
    // Mutation: add a "Revenues" fact (first in the priority list) for FY2026.
    (f.facts["us-gaap"] as Record<string, unknown>).Revenues = { label: "Revenues", units: { USD: [{ ...fy26Revenue(f), val: 478834000001 }] } };
    expect(annual(normalize(f), 2026).income?.revenue).toBe(478834000001);
  });

  it("skips a period whose original filing is missing instead of guessing its label", () => {
    const f = copy();
    // Mutation: remove every fact from the original FY2025 10-K, leaving only comparatives filed a year later.
    for (const c of Object.values(f.facts["us-gaap"]) as { units: Record<string, RawFact[]> }[]) {
      for (const u of Object.keys(c.units)) c.units[u] = c.units[u].filter((x) => x.accn !== "0000320193-25-000079");
    }
    const d = normalize(f);
    expect(d.annual.find((s) => s.period.periodEnd === "2025-09-27")).toBeUndefined();
    expect(d.notes?.join(" ")).toMatch(/reporting periods were skipped/);
  });

  it("reports the currency SEC uses; a mismatch with the instrument is rejected by validation", () => {
    const f = copy();
    // Mutation: relabel every monetary unit as EUR.
    for (const c of Object.values(f.facts["us-gaap"]) as { units: Record<string, RawFact[]> }[]) {
      if (c.units.USD) {
        c.units.EUR = c.units.USD;
        delete c.units.USD;
      }
      if (c.units["USD/shares"]) {
        c.units["EUR/shares"] = c.units["USD/shares"];
        delete c.units["USD/shares"];
      }
    }
    const d = normalize(f);
    expect(d.currency).toBe("EUR");
    expect(validateFundamentals(d, { expectedCurrency: "USD", now: NOW }).issues[0].message).toMatch(/reported in EUR/);
  });

  it("returns explicit missing reasons for IFRS-only or empty payloads, and errors on malformed ones", () => {
    expect(normalizeCompanyFacts({ cik: 1, entityName: "X", facts: { "ifrs-full": {} } }, OPTS)).toEqual({ missing: true, reason: expect.stringMatching(/IFRS/) });
    expect(normalizeCompanyFacts({ cik: 1, facts: { "us-gaap": {} } }, OPTS)).toMatchObject({ missing: true });
    expect(() => normalizeCompanyFacts({ hello: 1 }, OPTS)).toThrow(/unexpected format/);
    const bad = copy();
    usd(bad, "Assets")[0] = { ...usd(bad, "Assets")[0], val: "lots" as unknown as number }; // Mutation: non-numeric value
    expect(() => normalizeCompanyFacts(bad, OPTS)).toThrow(/Assets had an unexpected format/);
  });

  it("uses the latest annual period end when SEC gives no fiscal year end", () => {
    expect((normalizeCompanyFacts(factsFixture, { ...OPTS, fiscalYearEnd: null }) as CompanyFundamentals).fiscalYearEnd).toBe("09-26");
  });
});

describe("SecFinancialsProvider via loadFundamentals (mocked SEC)", () => {
  function fakeSec(overrides: Record<string, () => Response> = {}) {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (overrides[url]) return overrides[url]();
      if (url === TICKERS_URL) return json(tickersFixture);
      if (url === SUBMISSIONS_URL) return json(aaplSubmissions);
      if (url === FACTS_URL) return json(factsFixture);
      return new Response("Not Found", { status: 404 });
    });
    return { fetch, urls };
  }
  const provider = (fetch: ReturnType<typeof vi.fn>, timeoutMs?: number) =>
    new SecFinancialsProvider(new SecEdgarProvider({ userAgent: UA, fetch: fetch as never, sleep: async () => {}, timeoutMs }), { now: () => NOW.getTime() });
  const load = (p: SecFinancialsProvider, ref = AAPL, now = NOW, timeoutMs?: number) => loadFundamentals(p, ref, { now, timeoutMs });

  it("loads real, current, validated statements with source filings", async () => {
    const { fetch, urls } = fakeSec();
    const r = await load(provider(fetch));
    expect(urls).toEqual([TICKERS_URL, SUBMISSIONS_URL, FACTS_URL]);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r).toMatchObject({ origin: "real", label: "REAL · current", warnings: [] });
    expect(r.data).toMatchObject({ symbol: "AAPL", market: "NASDAQ", currency: "USD", fiscalYearEnd: "09-25" }); // FYE from SEC submissions
    expect(r.data.provenance).toEqual({ source: "sec-edgar-xbrl", origin: "real", fetchedAt: NOW.toISOString() });
    expect(r.completeness.completeness).toBe("partial"); // e.g. total debt is never reported
  });

  it("reports stale data when the latest period is old", async () => {
    const r = await load(provider(fakeSec().fetch), AAPL, new Date("2028-06-01T00:00:00Z"));
    expect(r).toMatchObject({ status: "ok", label: "REAL · stale" });
  });

  it("returns unsupported for non-US listings and indices without calling SEC", async () => {
    const { fetch } = fakeSec();
    expect(await load(provider(fetch), { symbol: "TCS", market: "NSE", type: "EQUITY", currency: "INR" })).toMatchObject({ status: "unsupported" });
    expect(await load(provider(fetch), { ...AAPL, symbol: "SPX", type: "INDEX" })).toMatchObject({ status: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns missing with a reason for unknown tickers and companies without XBRL data", async () => {
    expect(await load(provider(fakeSec().fetch), { ...AAPL, symbol: "ZZZZNOPE" })).toMatchObject({ status: "missing", reason: expect.stringMatching(/no company for ticker ZZZZNOPE/) });
    const r = await load(provider(fakeSec({ [FACTS_URL]: () => new Response("", { status: 404 }) }).fetch));
    expect(r).toMatchObject({ status: "missing", reason: expect.stringMatching(/no XBRL financial data for Apple Inc\./) });
  });

  it("surfaces SEC refusals, server errors, bad data and timeouts as explicit errors", async () => {
    expect(await load(provider(fakeSec({ [FACTS_URL]: () => new Response("", { status: 403 }) }).fetch))).toMatchObject({ status: "error", code: "FORBIDDEN" });
    resetSecEdgarState(); // clear the refusal pause between cases
    resetSecFinancialsCache();
    expect(await load(provider(fakeSec({ [FACTS_URL]: () => new Response("", { status: 500 }) }).fetch))).toMatchObject({ status: "error", code: "PROVIDER_ERROR" });
    resetSecFinancialsCache();
    expect(await load(provider(fakeSec({ [FACTS_URL]: () => json({ nope: true }) }).fetch))).toMatchObject({ status: "error", code: "INVALID_RESPONSE" });
    resetSecEdgarState();
    resetSecFinancialsCache();
    const hanging = vi.fn((url: string, init?: RequestInit) =>
      url === FACTS_URL
        ? new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))
        : fakeSec().fetch(url),
    );
    expect(await load(provider(hanging, 30))).toMatchObject({ status: "error", code: "TIMEOUT" });
  });

  it("rejects data in the wrong currency for the instrument (explicit invalid status)", async () => {
    const eur = copy();
    for (const c of Object.values(eur.facts["us-gaap"]) as { units: Record<string, RawFact[]> }[]) {
      if (c.units.USD) {
        c.units.EUR = c.units.USD; // Mutation: report in EUR
        delete c.units.USD;
      }
    }
    expect(await load(provider(fakeSec({ [FACTS_URL]: () => json(eur) }).fetch))).toMatchObject({ status: "invalid", reason: expect.stringMatching(/reported in EUR/) });
  });

  it("caches normalised results and de-duplicates concurrent loads", async () => {
    const { fetch, urls } = fakeSec();
    const p = provider(fetch);
    await Promise.all([load(p), load(p)]);
    await load(p);
    expect(urls.filter((u) => u === FACTS_URL)).toHaveLength(1);
  });
});

describe("registry", () => {
  it("FUNDAMENTALS_PROVIDER=sec requires SEC_USER_AGENT", () => {
    const off = createFundamentalsProvider({ FUNDAMENTALS_PROVIDER: "sec" });
    expect(off.provider).toBeNull();
    expect(off.status.missingEnv).toEqual(["SEC_USER_AGENT"]);
    const on = createFundamentalsProvider({ FUNDAMENTALS_PROVIDER: "SEC", SEC_USER_AGENT: UA });
    expect(on.provider).toBeInstanceOf(SecFinancialsProvider);
    expect(on.status).toMatchObject({ origin: "real", configured: true });
    expect(JSON.stringify(on.status)).not.toContain("ops@mint.test");
  });
});
