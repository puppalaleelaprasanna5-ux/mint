import { describe, expect, it } from "vitest";
import { computeChange, computeRangeStats, toPercentFromStart, trendOf } from "./quotes";
import { distanceToThresholdPercent, isPriceAlertType, isPriceConditionMet } from "./alerts";
import { rankBySearch, searchScore } from "./search";
import { formatMoney, formatPercent, formatPoints, formatTradingDate, formatVolume } from "./format";
import {
  barsQuerySchema,
  createAlertSchema,
  createWatchlistSchema,
  instrumentSearchQuerySchema,
  parseMarketFilter,
  updateAlertSchema,
  updateWatchlistSchema,
} from "./validation";

describe("quotes", () => {
  it("computes change from the last two closes", () => {
    const c = computeChange([{ close: 100 }, { close: 110 }]);
    expect(c?.change).toBe(10);
    expect(c?.changePercent).toBeCloseTo(10);
  });

  it("handles empty and single-bar series", () => {
    expect(computeChange([])).toBeNull();
    expect(computeChange([{ close: 5 }])).toEqual({ last: 5, previous: null, change: null, changePercent: null });
  });

  it("rebases series to % from start", () => {
    const r = toPercentFromStart([
      { time: "a", close: 200 },
      { time: "b", close: 250 },
      { time: "c", close: 150 },
    ]);
    expect(r.map((p) => p.value)).toEqual([0, 25, -25]);
  });

  it("computes range stats ignoring zero volume", () => {
    const s = computeRangeStats([
      { high: 10, low: 5, volume: 0 },
      { high: 12, low: 6, volume: 100 },
      { high: 11, low: 4, volume: 300 },
    ]);
    expect(s).toEqual({ high: 12, low: 4, averageVolume: 200 });
    expect(computeRangeStats([])).toBeNull();
  });

  it("classifies trend", () => {
    expect(trendOf(1)).toBe("up");
    expect(trendOf(-0.1)).toBe("down");
    expect(trendOf(0)).toBe("flat");
    expect(trendOf(null)).toBe("flat");
  });
});

describe("alert rules", () => {
  it("evaluates price thresholds inclusively", () => {
    expect(isPriceConditionMet("PRICE_ABOVE", 100, 100)).toBe(true);
    expect(isPriceConditionMet("PRICE_ABOVE", 100, 99.99)).toBe(false);
    expect(isPriceConditionMet("PRICE_BELOW", 100, 100)).toBe(true);
    expect(isPriceConditionMet("PRICE_BELOW", 100, 100.01)).toBe(false);
  });

  it("identifies price alert types", () => {
    expect(isPriceAlertType("PRICE_ABOVE")).toBe(true);
    expect(isPriceAlertType("VOLUME_SPIKE")).toBe(false);
  });

  it("computes distance to threshold", () => {
    expect(distanceToThresholdPercent(100, 110)).toBeCloseTo(10);
    expect(distanceToThresholdPercent(100, 90)).toBeCloseTo(-10);
    expect(distanceToThresholdPercent(0, 10)).toBeNull();
  });
});

describe("search ranking", () => {
  const items = [
    { symbol: "TCS", name: "Tata Consultancy Services" },
    { symbol: "AAPL", name: "Apple" },
    { symbol: "SBIN", name: "State Bank of India" },
    { symbol: "INFY", name: "Infosys" },
  ];

  it("ranks exact symbol, then prefix, then name word matches", () => {
    expect(searchScore("tcs", "TCS", "x")).toBe(0);
    expect(searchScore("inf", "INFY", "Infosys")).toBe(1);
    expect(searchScore("bank", "SBIN", "State Bank of India")).toBe(3);
    expect(searchScore("zzz", "SBIN", "State Bank of India")).toBeNull();
  });

  it("filters and orders results", () => {
    expect(rankBySearch(items, "a").map((i) => i.symbol)).toEqual(["AAPL", "SBIN", "TCS"]);
    expect(rankBySearch(items, "apple").map((i) => i.symbol)).toEqual(["AAPL"]);
  });
});

describe("formatting", () => {
  it("formats currencies with local grouping", () => {
    expect(formatMoney(1234567.5, "INR")).toBe("₹12,34,567.50");
    expect(formatMoney(1234567.5, "USD")).toBe("$1,234,567.50");
    expect(formatPoints(24312.5, "INR")).toBe("24,312.50");
  });

  it("formats percents with sign", () => {
    expect(formatPercent(1.234)).toBe("+1.23%");
    expect(formatPercent(-0.5)).toBe("−0.50%");
    expect(formatPercent(0)).toBe("0.00%");
  });

  it("formats volume compactly", () => {
    expect(formatVolume(12_345_678, "INR")).toBe("1.23Cr");
    expect(formatVolume(12_345_678, "USD")).toBe("12.35M");
  });

  it("formats trading dates without time-zone drift", () => {
    expect(formatTradingDate("2026-11-27")).toBe("27 Nov 2026");
    expect(formatTradingDate("2026-01-01")).toBe("1 Jan 2026");
  });
});

describe("validation", () => {
  it("parses market filter leniently", () => {
    expect(parseMarketFilter("in")).toBe("IN");
    expect(parseMarketFilter("US")).toBe("US");
    expect(parseMarketFilter("mars")).toBe("ALL");
    expect(parseMarketFilter(undefined)).toBe("ALL");
  });

  it("applies search defaults and bounds", () => {
    expect(instrumentSearchQuerySchema.parse({})).toEqual({ q: "", limit: 25 });
    expect(instrumentSearchQuerySchema.parse({ limit: "10", region: "IN" })).toEqual({ q: "", limit: 10, region: "IN" });
    expect(instrumentSearchQuerySchema.safeParse({ limit: "1000" }).success).toBe(false);
    expect(instrumentSearchQuerySchema.safeParse({ region: "EU" }).success).toBe(false);
  });

  it("validates bar ranges", () => {
    expect(barsQuerySchema.safeParse({ from: "2026-01-01", to: "2026-02-01" }).success).toBe(true);
    expect(barsQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-01" }).success).toBe(false);
    expect(barsQuerySchema.safeParse({ from: "01/02/2026" }).success).toBe(false);
    expect(barsQuerySchema.safeParse({ interval: "1h" }).success).toBe(false);
  });

  it("validates alerts", () => {
    expect(createAlertSchema.safeParse({ instrumentId: "abc", type: "PRICE_ABOVE", threshold: 100 }).success).toBe(true);
    expect(createAlertSchema.safeParse({ instrumentId: "abc", type: "PRICE_ABOVE", threshold: -1 }).success).toBe(false);
    expect(createAlertSchema.safeParse({ instrumentId: "abc", type: "VOLUME_SPIKE", threshold: 2 }).success).toBe(false);
    expect(createAlertSchema.safeParse({ instrumentId: "", type: "PRICE_BELOW", threshold: 1 }).success).toBe(false);
    expect(updateAlertSchema.safeParse({}).success).toBe(false);
    expect(updateAlertSchema.safeParse({ status: "TRIGGERED" }).success).toBe(false);
    expect(updateAlertSchema.safeParse({ status: "PAUSED" }).success).toBe(true);
  });

  it("validates watchlists", () => {
    expect(createWatchlistSchema.parse({ name: "  Tech  " })).toEqual({ name: "Tech" });
    expect(createWatchlistSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createWatchlistSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(updateWatchlistSchema.safeParse({}).success).toBe(false);
    expect(updateWatchlistSchema.safeParse({ isDefault: false }).success).toBe(false);
  });
});
