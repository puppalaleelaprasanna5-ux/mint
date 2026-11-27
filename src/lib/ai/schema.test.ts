import { describe, expect, it } from "vitest";
import { findPolicyViolations, stockExplanationSchema, type StockExplanation } from "./schema";
import { buildExplanationContext } from "./context";
import { buildTechnicalSummary } from "../technical-summary";
import { addDays, isWeekend } from "../time";
import type { BarDTO } from "../types";

export const validExplanation = (): StockExplanation => ({
  summary: "Prices have risen over the past year but dipped this month.",
  trend: { shortTerm: "Short term: sideways.", longTerm: "Long term: uptrend." },
  momentum: "Momentum has been negative recently.",
  risk: "Risk is moderate, with volatility around 22%.",
  keyLevels: "Support near 4,800 and resistance near 5,000.",
  considerations: ["Compare the two trends."],
  limitations: ["Based only on past prices."],
  confidence: "medium",
});

describe("stockExplanationSchema", () => {
  it("accepts a well-formed explanation", () => {
    expect(stockExplanationSchema.safeParse(validExplanation()).success).toBe(true);
  });

  it("rejects missing fields, extra fields and wrong types", () => {
    const { momentum: _omit, ...missing } = validExplanation();
    void _omit;
    expect(stockExplanationSchema.safeParse(missing).success).toBe(false);
    expect(stockExplanationSchema.safeParse({ ...validExplanation(), buyRating: "strong" }).success).toBe(false);
    expect(stockExplanationSchema.safeParse({ ...validExplanation(), confidence: "certain" }).success).toBe(false);
    expect(stockExplanationSchema.safeParse({ ...validExplanation(), trend: { shortTerm: "x" } }).success).toBe(false);
  });

  it("enforces lengths and list sizes", () => {
    expect(stockExplanationSchema.safeParse({ ...validExplanation(), summary: "   " }).success).toBe(false);
    expect(stockExplanationSchema.safeParse({ ...validExplanation(), summary: "x".repeat(801) }).success).toBe(false);
    expect(stockExplanationSchema.safeParse({ ...validExplanation(), limitations: [] }).success).toBe(false);
    expect(stockExplanationSchema.safeParse({ ...validExplanation(), considerations: Array(6).fill("a") }).success).toBe(false);
  });
});

describe("findPolicyViolations", () => {
  const withSummary = (summary: string) => ({ ...validExplanation(), summary });

  it.each([
    ["Returns are guaranteed.", "promises an outcome"],
    ["This is a risk-free stock.", "risk-free"],
    ["I am 100% sure about this.", "certainty"],
    ["It will definitely recover.", "certainty"],
    ["The price will rise next month.", "forecasts"],
    ["The stock will crash.", "forecasts"],
    ["Our price target is 6000.", "price target"],
    ["You should buy this stock.", "trading instruction"],
    ["We recommend that you sell.", "trading instruction"],
    ["Buy now before it is too late.", "trading instruction"],
    ["This is a strong buy signal.", "buy/sell rating"],
  ])("flags %j", (summary, reason) => {
    const v = findPolicyViolations(withSummary(summary));
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].field).toBe("summary");
    expect(v[0].reason).toMatch(reason);
  });

  it.each([
    "There is no guarantee that this pattern continues.",
    "Investing is not risk-free.",
    "The price fell 12% from its high.",
    "Buyers and sellers were balanced this week.",
    "Past rises do not mean the price keeps rising.",
  ])("allows responsible wording: %j", (summary) => {
    expect(findPolicyViolations(withSummary(summary))).toEqual([]);
  });

  it("checks nested fields and lists", () => {
    const e = { ...validExplanation(), trend: { shortTerm: "ok", longTerm: "It will double." }, considerations: ["fine", "Sell immediately."] };
    expect(findPolicyViolations(e).map((v) => v.field)).toEqual(["trend.longTerm", "considerations[1]"]);
  });
});

describe("buildExplanationContext", () => {
  function bars(n: number): BarDTO[] {
    const out: BarDTO[] = [];
    let d = "2025-01-06";
    for (let i = 0; i < n; i++) {
      while (isWeekend(d)) d = addDays(d, 1);
      const close = 100 + i * 0.2 + 3 * Math.sin(i / 6);
      out.push({ time: d, timestamp: `${d}T03:45:00.000Z`, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 });
      d = addDays(d, 1);
    }
    return out;
  }
  const inst = { symbol: "TCS", name: "Tata Consultancy Services", type: "EQUITY", market: "NSE", currency: "INR" };

  it("passes only computed facts (no raw price history)", () => {
    const ctx = buildExplanationContext(inst, buildTechnicalSummary(bars(260), { isSimulated: true }));
    expect(ctx.hasAnalysis).toBe(true);
    expect(ctx.data).toMatchObject({ isSimulated: true, barsAnalyzed: 260 });
    expect(ctx.trend?.longTerm.direction).toMatch(/bullish|bearish|sideways/);
    expect(ctx.risk?.volatilityPct).toBeGreaterThan(0);
    expect(JSON.stringify(ctx).length).toBeLessThan(3000);
    expect(JSON.stringify(ctx)).not.toContain("timestamp");
  });

  it("marks missing analysis", () => {
    const ctx = buildExplanationContext(inst, buildTechnicalSummary([], { isSimulated: false }));
    expect(ctx).toMatchObject({ hasAnalysis: false, trend: null, momentum: null, risk: null, levels: null });
  });
});
