import { describe, expect, it } from "vitest";
import { generateBars, generateMarketFactor } from "./generate";
import { DEMO_INSTRUMENTS, DEMO_MARKETS } from "./universe";
import { isWeekend, weekdaysBetween } from "../time";

const dates = weekdaysBetween("2025-01-01", "2026-06-30");
const params = { startPrice: 1000, annualDrift: 0.1, annualVol: 0.3, marketCorrelation: 0.6, baseVolume: 1_000_000 };

describe("demo bar generator", () => {
  it("is deterministic for the same seed", () => {
    const f = generateMarketFactor(dates, "IN");
    expect(generateBars(dates, f, params, "X")).toEqual(generateBars(dates, f, params, "X"));
  });

  it("differs across instruments", () => {
    const f = generateMarketFactor(dates, "IN");
    const a = generateBars(dates, f, params, "A");
    const b = generateBars(dates, f, params, "B");
    expect(a.at(-1)?.close).not.toBe(b.at(-1)?.close);
  });

  it("produces one bar per trading date and never a weekend", () => {
    const bars = generateBars(dates, generateMarketFactor(dates, "US"), params, "Y");
    expect(bars).toHaveLength(dates.length);
    expect(bars.every((b) => !isWeekend(b.tradingDate))).toBe(true);
    expect(new Set(bars.map((b) => b.tradingDate)).size).toBe(bars.length); // no duplicates
  });

  it("satisfies OHLC invariants and positive prices", () => {
    const f = generateMarketFactor(dates, "IN");
    for (const spec of DEMO_INSTRUMENTS) {
      for (const b of generateBars(dates, f, spec.sim, spec.symbol)) {
        expect(b.low).toBeGreaterThan(0);
        expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
        expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
        expect(b.volume).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives indices zero volume and stocks positive volume", () => {
    const f = generateMarketFactor(dates, "IN");
    const idx = generateBars(dates, f, { ...params, baseVolume: 0 }, "IDX");
    expect(idx.every((b) => b.volume === 0)).toBe(true);
    const stk = generateBars(dates, f, params, "STK");
    expect(stk.every((b) => b.volume > 0)).toBe(true);
  });

  it("rejects mismatched factor length", () => {
    expect(() => generateBars(dates, [1, 2], params, "Z")).toThrow();
  });

  it("has realistic daily volatility (within 2x of target)", () => {
    const bars = generateBars(dates, generateMarketFactor(dates, "IN"), params, "VOL");
    const rets = bars.slice(1).map((b, i) => Math.log(b.close / bars[i].close));
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1));
    const target = params.annualVol / Math.sqrt(252);
    expect(sd).toBeGreaterThan(target / 2);
    expect(sd).toBeLessThan(target * 2);
  });
});

describe("demo universe", () => {
  it("references only defined markets and has unique symbols per market", () => {
    const codes = new Set(DEMO_MARKETS.map((m) => m.code));
    const keys = DEMO_INSTRUMENTS.map((i) => `${i.market}:${i.symbol}`);
    expect(DEMO_INSTRUMENTS.every((i) => codes.has(i.market))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the four dashboard benchmarks", () => {
    const symbols = DEMO_INSTRUMENTS.filter((i) => i.type === "INDEX").map((i) => i.symbol);
    expect(symbols).toEqual(expect.arrayContaining(["NIFTY50", "SENSEX", "IXIC", "SPX"]));
  });
});
