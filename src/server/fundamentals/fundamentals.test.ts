import { describe, expect, it, vi } from "vitest";
import { MockFundamentalsProvider, MOCK_FUNDAMENTALS_SOURCE } from "./providers/mock";
import { loadFundamentals } from "./load";
import { createFundamentalsProvider } from "./registry";
import { FundamentalsError, type FundamentalsProvider } from "./provider";
import { validateFundamentals } from "@/lib/fundamentals/validate";
import type { CompanyFundamentals, FundamentalsInstrumentRef } from "@/lib/fundamentals/types";

const NOW = new Date("2026-11-27T12:00:00Z");
const TCS: FundamentalsInstrumentRef = { symbol: "TCS", market: "NSE", type: "EQUITY", currency: "INR" };
const AAPL: FundamentalsInstrumentRef = { symbol: "AAPL", market: "NASDAQ", type: "EQUITY", currency: "USD" };
const NIFTY: FundamentalsInstrumentRef = { symbol: "NIFTY50", market: "NSE", type: "INDEX", currency: "INR" };
const mock = (opts = {}) => new MockFundamentalsProvider({ asOf: () => NOW, ...opts });

describe("MockFundamentalsProvider", () => {
  it("is deterministic and labelled mock", async () => {
    const a = await mock().fetchFundamentals(TCS);
    const b = await mock().fetchFundamentals(TCS);
    expect(a).toEqual(b);
    expect(a?.provenance).toEqual({ source: MOCK_FUNDAMENTALS_SOURCE, origin: "mock", fetchedAt: NOW.toISOString() });
    expect(mock().status()).toMatchObject({ origin: "mock", configured: true });
  });

  it("produces data that passes validation", async () => {
    for (const ref of [TCS, AAPL]) {
      const v = validateFundamentals(await mock().fetchFundamentals(ref), { expectedCurrency: ref.currency, now: NOW });
      expect(v.issues).toEqual([]);
      expect(v.valid).toBe(true);
    }
  });

  it("uses the Indian fiscal year (April–March) for NSE companies", async () => {
    const d = (await mock().fetchFundamentals(TCS))!;
    expect(d.fiscalYearEnd).toBe("03-31");
    // By 2026-11-27, FY2026 (Apr 2025 – Mar 2026) has been published (+60 days); FY2027 has not ended.
    expect(d.annual[0].period).toMatchObject({ fiscalYear: 2026, periodStart: "2025-04-01", periodEnd: "2026-03-31", filedAt: "2026-05-30" });
    expect(d.annual.map((s) => s.period.fiscalYear)).toEqual([2026, 2025, 2024, 2023]);
    // Latest published quarter: Jul–Sep 2026 = Q2 of FY2027 (published +45 days = 2026-11-14).
    expect(d.quarterly[0].period).toMatchObject({ fiscalYear: 2027, fiscalQuarter: 2, periodStart: "2026-07-01", periodEnd: "2026-09-30", filedAt: "2026-11-14" });
    expect(d.quarterly[1].period).toMatchObject({ fiscalYear: 2027, fiscalQuarter: 1, periodEnd: "2026-06-30" });
    expect(d.quarterly[2].period).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 4, periodStart: "2026-01-01", periodEnd: "2026-03-31" });
    expect(d.quarterly).toHaveLength(8);
  });

  it("uses a calendar fiscal year for US companies", async () => {
    const d = (await mock().fetchFundamentals(AAPL))!;
    expect(d.fiscalYearEnd).toBe("12-31");
    expect(d.annual[0].period).toMatchObject({ fiscalYear: 2025, periodStart: "2025-01-01", periodEnd: "2025-12-31" });
    expect(d.quarterly[0].period).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 3, periodEnd: "2026-09-30" });
  });

  it("only publishes periods whose filing date has passed", async () => {
    const d = (await mock().fetchFundamentals(TCS))!;
    for (const s of [...d.annual, ...d.quarterly]) expect(s.period.filedAt! <= "2026-11-27").toBe(true);
    // Just before the Q2 filing date, the latest quarter is Q1.
    const early = (await mock({ asOf: () => new Date("2026-11-10T00:00:00Z") }).fetchFundamentals(TCS))!;
    expect(early.quarterly[0].period.periodEnd).toBe("2026-06-30");
  });

  it("keeps accounting identities exact and quarters consistent with the year", async () => {
    const d = (await mock().fetchFundamentals(TCS))!;
    for (const s of [...d.annual, ...d.quarterly]) {
      const i = s.income!;
      const b = s.balance!;
      expect(i.grossProfit).toBe(i.revenue! - i.costOfRevenue!);
      expect(i.netIncome).toBe(i.pretaxIncome! - i.incomeTax!);
      expect(b.totalAssets).toBe(b.totalLiabilities! + b.totalEquity!);
      expect(s.cashFlow!.capitalExpenditure!).toBeLessThan(0); // outflows are negative
      for (const v of [...Object.values(i), ...Object.values(b)]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
    }
    // FY2026 = quarters ending 2025-06, 2025-09, 2025-12, 2026-03 → sums to the annual revenue (± rounding).
    const fy26 = d.quarterly.filter((s) => s.period.fiscalYear === 2026).reduce((sum, s) => sum + s.income!.revenue!, 0);
    expect(Math.abs(fy26 - d.annual[0].income!.revenue!)).toBeLessThanOrEqual(4);
  });

  it("returns null for unknown companies and does not support indices or other markets", async () => {
    expect(await mock().fetchFundamentals({ ...TCS, symbol: "UNKNOWNCO" })).toBeNull();
    expect(mock().supports(NIFTY)).toBe(false);
    expect(mock().supports({ ...TCS, market: "LSE" })).toBe(false);
    expect(mock().supports(TCS)).toBe(true);
  });

  it("can omit figures, leaving them null rather than estimated", async () => {
    const d = (await mock({ omitSomeFields: true }).fetchFundamentals(TCS))!;
    expect(d.quarterly[1].income?.interestExpense).toBeNull();
    expect(d.quarterly[3].cashFlow).toBeNull();
    expect(d.quarterly[0].income?.interestExpense).not.toBeNull();
  });
});

describe("loadFundamentals", () => {
  const load = (p: FundamentalsProvider | null, ref = TCS, timeoutMs?: number) => loadFundamentals(p, ref, { now: NOW, timeoutMs });

  it("returns disabled when no provider is configured", async () => {
    expect(await load(null)).toMatchObject({ status: "disabled" });
  });

  it("returns unsupported for indices and funds without calling the provider", async () => {
    const p = mock();
    const spy = vi.spyOn(p, "fetchFundamentals");
    expect(await load(p, NIFTY)).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/an index/) });
    expect(await load(p, { ...TCS, type: "ETF" })).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/a fund/) });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns missing when the provider has no data", async () => {
    expect(await load(mock(), { ...TCS, symbol: "UNKNOWNCO" })).toMatchObject({ status: "missing", provider: "Mock fundamentals (development)" });
  });

  it("loads current, complete mock data with explicit labels", async () => {
    const r = await load(mock());
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r).toMatchObject({ origin: "mock", label: "MOCK · current", warnings: [] });
    expect(r.freshness).toMatchObject({ freshness: "current", latestPeriodEnd: "2026-09-30" });
    expect(r.completeness.completeness).toBe("complete");
    expect(r.explanation).toMatch(/MOCK data/);
  });

  it("flags partial data", async () => {
    const r = await load(mock({ omitSomeFields: true }));
    expect(r.status === "ok" && r.completeness.completeness).toBe("partial");
    if (r.status === "ok") expect(r.explanation).toMatch(/Some figures were not reported/);
  });

  it("flags stale data", async () => {
    const old = mock({ asOf: () => new Date("2024-06-01T00:00:00Z") });
    const r = await load(old);
    expect(r).toMatchObject({ status: "ok", label: "MOCK · stale" });
    if (r.status === "ok") expect(r.explanation).toMatch(/newer results are probably missing/);
  });

  it("never upgrades mock data to real, even if the payload claims so", async () => {
    const p = mock();
    const real = p.fetchFundamentals.bind(p);
    vi.spyOn(p, "fetchFundamentals").mockImplementation(async (ref) => {
      const d = (await real(ref))!;
      return { ...d, provenance: { ...d.provenance, origin: "real" } };
    });
    const r = await load(p);
    expect(r).toMatchObject({ status: "ok", origin: "mock", label: "MOCK · current" });
    if (r.status === "ok") expect(r.data.provenance.origin).toBe("mock");
  });

  const stub = (impl: FundamentalsProvider["fetchFundamentals"], origin: "real" | "mock" = "real"): FundamentalsProvider => ({
    id: "stub",
    name: "Stub",
    origin,
    status: () => ({ id: "stub", name: "Stub", origin, configured: true, missingEnv: [], notes: [] }),
    supports: () => true,
    fetchFundamentals: impl,
  });

  it("rejects invalid provider data instead of showing it", async () => {
    const good = (await mock().fetchFundamentals(TCS))!;
    const usd = await load(stub(async () => ({ ...good, currency: "USD" })));
    expect(usd).toMatchObject({ status: "invalid", reason: expect.stringMatching(/reported in USD/) });
    const junk = await load(stub(async () => ({ hello: "world" }) as unknown as CompanyFundamentals));
    expect(junk.status).toBe("invalid");
    const other = await load(stub(async () => ({ ...good, symbol: "INFY" })));
    expect(other).toMatchObject({ status: "invalid", reason: expect.stringMatching(/not TCS/) });
  });

  it("treats a payload with no figures at all as missing", async () => {
    const good = (await mock().fetchFundamentals(TCS))!;
    const empty = { ...good, annual: [], quarterly: [] };
    expect(await load(stub(async () => empty))).toMatchObject({ status: "missing" });
  });

  it("passes provider errors through and hides unexpected ones", async () => {
    expect(await load(stub(async () => { throw new FundamentalsError("RATE_LIMITED", "Try again in 30s"); }))).toEqual({
      status: "error",
      code: "RATE_LIMITED",
      reason: "Try again in 30s",
      provider: "Stub",
    });
    const hidden = await load(stub(async () => { throw new Error("db password=hunter2"); }));
    expect(hidden).toEqual({ status: "error", code: "PROVIDER_ERROR", reason: "The fundamentals provider failed unexpectedly.", provider: "Stub" });
    const sync = await load(stub(() => { throw new TypeError("sync boom"); }));
    expect(sync.status).toBe("error");
  });

  it("times out a hanging provider and aborts it", async () => {
    let aborted = false;
    const hanging = stub(
      (_ref, { signal: s }) =>
        new Promise((_, reject) => {
          s.addEventListener("abort", () => {
            aborted = true;
            reject(new FundamentalsError("TIMEOUT", "aborted"));
          });
        }),
    );
    expect(await load(hanging, TCS, 30)).toMatchObject({ status: "error", code: "TIMEOUT" });
    expect(aborted).toBe(true);
  });
});

describe("createFundamentalsProvider", () => {
  it("is off by default", () => {
    expect(createFundamentalsProvider({}).provider).toBeNull();
    expect(createFundamentalsProvider({}).status.origin).toBeNull(); // no data → no origin claim
    expect(createFundamentalsProvider({ FUNDAMENTALS_PROVIDER: "none" }).provider).toBeNull();
  });

  it("selects the mock provider", () => {
    expect(createFundamentalsProvider({ FUNDAMENTALS_PROVIDER: "Mock" }).provider).toBeInstanceOf(MockFundamentalsProvider);
  });

  it("rejects unknown providers", () => {
    const r = createFundamentalsProvider({ FUNDAMENTALS_PROVIDER: "screener" });
    expect(r.provider).toBeNull();
    expect(r.status.notes[0]).toMatch(/not supported/);
  });
});
