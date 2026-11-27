import { describe, expect, it } from "vitest";
import {
  analyzeTrend,
  classifyVotes,
  clusterLevels,
  confidenceLevel,
  DISCLAIMER,
  findPivots,
  rsiZone,
  type TrendBar,
  type Vote,
} from "./trend-analysis";
import { addDays } from "./time";

/** Daily bars from closes; high/low ±0.5% unless `exact` (high = low = close). */
function barsFrom(closes: number[], exact = false): TrendBar[] {
  let d = "2024-01-01";
  return closes.map((close) => {
    d = addDays(d, 1);
    return { time: d, close, high: exact ? close : close * 1.005, low: exact ? close : close * 0.995 };
  });
}
const series = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe("classifyVotes", () => {
  const cases: [Vote[], string, boolean, number, string, string | null][] = [
    // votes, direction, conflicting, score, level, lean
    [[1, 1, 1], "bullish", false, 1, "high", null],
    [[1, 1, 0], "bullish", false, 0.667, "medium", null],
    [[-1, -1, -1], "bearish", false, 1, "high", null],
    [[-1, 0, -1], "bearish", false, 0.667, "medium", null],
    [[0, 0, 0], "sideways", false, 1, "high", null],
    [[1, 0, 0], "sideways", false, 0.667, "medium", null],
    [[1, 1, -1], "sideways", true, 0.167, "low", "bullish"],
    [[-1, -1, 1], "sideways", true, 0.167, "low", "bearish"],
    [[1, -1, 0], "sideways", true, 0, "none", null],
  ];
  it.each(cases)("%j → %s", (votes, direction, conflicting, score, level, lean) => {
    const c = classifyVotes(votes);
    expect(c.direction).toBe(direction);
    expect(c.conflicting).toBe(conflicting);
    expect(c.confidence.score).toBeCloseTo(score, 3);
    expect(c.confidence.level).toBe(level);
    expect(c.lean).toBe(lean);
  });

  it("lowers confidence when expected signals are missing", () => {
    expect(classifyVotes([1], 3)).toMatchObject({ direction: "bullish", confidence: { score: 0.333, level: "low" } });
    expect(classifyVotes([1, 1], 3).confidence.level).toBe("medium");
    expect(classifyVotes([], 3)).toMatchObject({ direction: "sideways", confidence: { score: 0, level: "none" } });
  });
});

describe("confidenceLevel / rsiZone", () => {
  it("maps scores to levels", () => {
    expect([0, 0.2, 0.66, 0.99, 1].map(confidenceLevel)).toEqual(["none", "low", "medium", "high", "high"]);
  });
  it("classifies RSI zones at their boundaries", () => {
    expect([80, 70, 60, 55, 50, 45, 40, 30, 10].map((v) => rsiZone(v))).toEqual([
      "overbought", "overbought", "bullish", "neutral", "neutral", "neutral", "bearish", "oversold", "oversold",
    ]);
  });
});

describe("analyzeTrend — classifications", () => {
  it("steady uptrend: bullish short and long term, aligned, bullish momentum, overbought caution", () => {
    const r = analyzeTrend(barsFrom(series(260, (i) => 100 * 1.003 ** i)));
    expect(r.shortTerm).toMatchObject({ direction: "bullish", conflicting: false, confidence: { level: "high" } });
    expect(r.longTerm).toMatchObject({ direction: "bullish", conflicting: false, confidence: { level: "high" } });
    expect(r.alignment).toBe("aligned");
    expect(r.momentum.bias).toBe("bullish");
    expect(r.momentum.rsi).toBe(100);
    expect(r.momentum.rsiZone).toBe("overbought");
    expect(r.momentum.cautions.join(" ")).toMatch(/overbought/);
    expect(r.momentum.cautions.join(" ")).toMatch(/not a signal to sell/);
  });

  it("steady downtrend: bearish everywhere, oversold caution", () => {
    const r = analyzeTrend(barsFrom(series(260, (i) => 100 * 0.997 ** i)));
    expect(r.shortTerm.direction).toBe("bearish");
    expect(r.longTerm.direction).toBe("bearish");
    expect(r.alignment).toBe("aligned");
    expect(r.momentum.bias).toBe("bearish");
    expect(r.momentum.rsiZone).toBe("oversold");
    expect(r.momentum.cautions.join(" ")).toMatch(/not by itself a signal to buy/);
  });

  it("flat, gently oscillating prices: sideways, not conflicting", () => {
    const r = analyzeTrend(barsFrom(series(260, (i) => 100 + 0.3 * Math.sin(i / 3))));
    expect(r.shortTerm).toMatchObject({ direction: "sideways", conflicting: false });
    expect(r.longTerm).toMatchObject({ direction: "sideways", conflicting: false, confidence: { level: "high" } });
    expect(r.alignment).toBe("aligned");
    // The last bars are a down-swing, so RSI/MACD read bearish, but the swing is only ~0.6%:
    // momentum confidence must be capped and the reason explained.
    expect(r.momentum.confidence.level).toBe("low");
    expect(r.momentum.cautions.join(" ")).toMatch(/exaggerate very small swings/);
  });

  it("does not cap momentum confidence when moves are meaningful", () => {
    const r = analyzeTrend(barsFrom(series(260, (i) => 100 * 0.997 ** i)));
    expect(r.momentum.confidence.level).not.toBe("low");
    expect(r.momentum.cautions.join(" ")).not.toMatch(/exaggerate/);
  });

  it("long uptrend with a sharp recent drop: short bearish vs long bullish → diverging", () => {
    const up = series(240, (i) => 100 * 1.003 ** i);
    const drop = series(12, (i) => up[239] * 0.985 ** (i + 1));
    const r = analyzeTrend(barsFrom([...up, ...drop]));
    expect(r.shortTerm.direction).toBe("bearish");
    expect(r.longTerm.direction).toBe("bullish");
    expect(r.alignment).toBe("diverging");
    expect(r.summary.join(" ")).toMatch(/point different ways/);
  });

  it("downtrend with a sudden one-day jump: conflicting short-term signals", () => {
    const down = series(60, (i) => 100 * 0.99 ** i);
    const r = analyzeTrend(barsFrom([...down, down[59] * 1.12]));
    const votes = r.shortTerm.signals.map((s) => s.vote);
    expect(votes).toContain(1); // price jumped above the 20-day EMA
    expect(votes).toContain(-1); // averages still point down
    expect(r.shortTerm).toMatchObject({ direction: "sideways", conflicting: true, confidence: { level: "low" } });
    expect(r.shortTerm.explanation).toMatch(/signals disagree/);
    expect(r.alignment).toBe("unclear"); // long term lacks data and short term conflicts
  });
});

describe("analyzeTrend — insufficient history", () => {
  it("handles no bars at all", () => {
    const r = analyzeTrend([]);
    expect(r).toMatchObject({ asOf: null, lastClose: null, barsAnalyzed: 0, alignment: "unclear" });
    expect(r.shortTerm.direction).toBe("insufficient_data");
    expect(r.longTerm.direction).toBe("insufficient_data");
    expect(r.momentum.bias).toBe("insufficient_data");
    expect(r.levels.insufficientData).toBe(true);
  });

  it("10 bars: nothing can be assessed, with required counts explained", () => {
    const r = analyzeTrend(barsFrom(series(10, (i) => 100 + i)));
    expect(r.shortTerm).toMatchObject({ direction: "insufficient_data", requiredBars: 25, availableBars: 10, confidence: { level: "none" } });
    expect(r.shortTerm.explanation).toMatch(/needs 25 daily bars, 10 available/);
    expect(r.momentum.explanation).toMatch(/RSI needs 15/);
    expect(r.levels.explanation).toMatch(/needs 11 daily bars/);
  });

  it("20 bars: momentum from RSI only, with lower confidence and a caution", () => {
    const r = analyzeTrend(barsFrom(series(20, (i) => 100 + i)));
    expect(r.momentum.macd).toBeNull();
    expect(r.momentum.signals.map((s) => s.name)).toEqual(["RSI (14)"]);
    expect(r.momentum).toMatchObject({ bias: "bullish", confidence: { score: 0.333, level: "low" } });
    expect(r.momentum.cautions.join(" ")).toMatch(/MACD needs at least 26 bars/);
  });

  it("30 bars: MACD line but no signal line yet", () => {
    const r = analyzeTrend(barsFrom(series(30, (i) => 100 + i)));
    expect(r.momentum.signals.map((s) => s.name)).toEqual(["RSI (14)", "MACD vs zero"]);
    expect(r.momentum.macd).toBeNull();
    expect(r.momentum.cautions.join(" ")).toMatch(/signal line needs 34 bars/);
  });

  it("100 bars: short term available, long term needs 220", () => {
    const r = analyzeTrend(barsFrom(series(100, (i) => 100 * 1.003 ** i)));
    expect(r.shortTerm.direction).toBe("bullish");
    expect(r.longTerm).toMatchObject({ direction: "insufficient_data", requiredBars: 220, availableBars: 100 });
    expect(r.alignment).toBe("unclear");
    expect(r.momentum.histogramTrend).not.toBeNull();
  });

  it("custom periods make the long-term view available sooner", () => {
    const r = analyzeTrend(barsFrom(series(100, (i) => 100 * 1.003 ** i)), { longFast: 20, longSlow: 50, longSlopeBars: 10 });
    expect(r.longTerm).toMatchObject({ direction: "bullish", requiredBars: 60 });
  });
});

describe("support and resistance", () => {
  // Triangle wave 90 ↔ 110 (period 20), ending at 100 on the way up.
  const zigzag = series(206, (i) => {
    const p = i % 20;
    return p <= 10 ? 90 + p * 2 : 110 - (p - 10) * 2;
  });

  it("finds the repeated swing low as support and swing high as resistance", () => {
    const r = analyzeTrend(barsFrom(zigzag, true));
    expect(r.lastClose).toBe(100);
    expect(r.levels.support[0]).toMatchObject({ price: 90, strength: "strong" });
    expect(r.levels.resistance[0]).toMatchObject({ price: 110, strength: "strong" });
    expect(r.levels.support[0].touches).toBeGreaterThanOrEqual(9);
    expect(r.levels.support[0].distancePercent).toBeCloseTo(-10, 6);
    expect(r.levels.resistance[0].distancePercent).toBeCloseTo(10, 6);
    expect(r.levels).toMatchObject({ rangeLow: 90, rangeHigh: 110, insufficientData: false });
    expect(r.levels.explanation).toMatch(/Nearest support ≈ 90\.00/);
  });

  it("reports no resistance after a breakout above every prior swing high", () => {
    const breakout = [...zigzag, ...series(10, (i) => 112 + i * 2)];
    const r = analyzeTrend(barsFrom(breakout, true));
    expect(r.levels.resistance).toEqual([]);
    expect(r.levels.explanation).toMatch(/near the top/);
    expect(r.levels.support[0].price).toBe(110); // old resistance now below price
  });

  it("orders levels nearest first and caps them", () => {
    const steps = series(200, (i) => [100, 104, 100, 108, 100, 112, 100, 116][Math.floor(i / 6) % 8] + (i % 6 === 3 ? 1 : 0));
    const r = analyzeTrend(barsFrom(steps, true), { maxLevels: 2 });
    expect(r.levels.resistance.length).toBeLessThanOrEqual(2);
    const prices = r.levels.resistance.map((l) => l.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("findPivots counts a flat top once (strict on the left, inclusive on the right)", () => {
    const b = barsFrom([1, 2, 3, 5, 5, 3, 2, 1, 2], true);
    expect(findPivots(b, 2).highs.map((p) => p.time)).toEqual([b[3].time]);
  });

  it("clusterLevels merges prices within tolerance", () => {
    const pivots = [100, 100.5, 101, 110].map((price, i) => ({ price, time: `2026-01-0${i + 1}` }));
    expect(clusterLevels(pivots, 1.5)).toEqual([
      { price: 100.5, touches: 3, lastTouched: "2026-01-03" },
      { price: 110, touches: 1, lastTouched: "2026-01-04" },
    ]);
  });
});

describe("input validation and output contract", () => {
  it("rejects unsorted or duplicate dates, inverted bars and non-finite prices", () => {
    const b = barsFrom([1, 2, 3]);
    expect(() => analyzeTrend([b[1], b[0]])).toThrow(/ascending/);
    expect(() => analyzeTrend([b[0], b[0]])).toThrow(/ascending/);
    expect(() => analyzeTrend([{ ...b[0], high: 1, low: 2 }])).toThrow(/high below low/);
    expect(() => analyzeTrend([{ ...b[0], close: Number.NaN }])).toThrow(RangeError);
  });

  it("always includes the disclaimer, an as-of date and per-signal explanations", () => {
    const r = analyzeTrend(barsFrom(series(260, (i) => 100 * 1.003 ** i)));
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r.asOf).toBe(barsFrom(series(260, () => 1))[259].time);
    for (const s of [...r.shortTerm.signals, ...r.longTerm.signals, ...r.momentum.signals]) {
      expect(s.explanation.length).toBeGreaterThan(10);
    }
    expect(r.summary.length).toBeGreaterThanOrEqual(4);
  });
});
