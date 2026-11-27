import { describe, expect, it } from "vitest";
import { closes, ema, latestValue, rsi, sma, toIndicatorSeries, type IndicatorValue } from "./indicators";
import type { BarDTO } from "./types";

/** Compare nullable series with floating tolerance. */
function expectSeries(actual: IndicatorValue[], expected: IndicatorValue[], digits = 6) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    if (e === null) expect(actual[i], `index ${i}`).toBeNull();
    else expect(actual[i], `index ${i}`).toBeCloseTo(e, digits);
  });
}

describe("sma", () => {
  it("averages the trailing window (hand-computed)", () => {
    // (1+2+3)/3=2, (2+3+4)/3=3, (3+4+5)/3=4, (4+5+9)/3=6
    expectSeries(sma([1, 2, 3, 4, 5, 9], 3), [null, null, 2, 3, 4, 6]);
  });

  it("period 1 returns the input", () => {
    expectSeries(sma([5, 7, 9], 1), [5, 7, 9]);
  });

  it("returns all nulls with insufficient data, and [] for no data", () => {
    expectSeries(sma([1, 2], 3), [null, null]);
    expect(sma([], 5)).toEqual([]);
  });

  it("first value appears exactly when the window fills", () => {
    expectSeries(sma([10, 20, 30], 3), [null, null, 20]);
  });

  it("stays accurate on long series (no running-sum drift)", () => {
    const values = Array.from({ length: 10_000 }, (_, i) => 100 + Math.sin(i) * 0.1);
    const out = sma(values, 20);
    const direct = values.slice(-20).reduce((s, v) => s + v, 0) / 20;
    expect(out.at(-1)).toBeCloseTo(direct, 9);
  });
});

describe("ema", () => {
  it("seeds with the SMA and applies k = 2/(n+1) (hand-computed, k = 0.5)", () => {
    // period 3 → k = 0.5; seed = (2+4+6)/3 = 4
    // i=3: (8−4)·0.5+4 = 6;  i=4: (12−6)·0.5+6 = 9;  i=5: (9−9)·0.5+9 = 9
    expectSeries(ema([2, 4, 6, 8, 12, 9], 3), [null, null, 4, 6, 9, 9]);
  });

  it("uses k = 2/(period+1) for other periods (period 4 → k = 0.4)", () => {
    // seed = (1+2+3+4)/4 = 2.5; i=4: (10−2.5)·0.4+2.5 = 5.5; i=5: (0−5.5)·0.4+5.5 = 3.3
    expectSeries(ema([1, 2, 3, 4, 10, 0], 4), [null, null, null, 2.5, 5.5, 3.3]);
  });

  it("of a constant series is that constant", () => {
    expectSeries(ema([7, 7, 7, 7, 7], 2), [null, 7, 7, 7, 7]);
  });

  it("returns all nulls with insufficient data", () => {
    expectSeries(ema([1, 2], 5), [null, null]);
    expect(ema([], 3)).toEqual([]);
  });
});

describe("rsi", () => {
  it("matches a hand-computed Wilder example (period 2)", () => {
    // changes: +2, −1, +2, 0
    // i=2: avgGain=(2+0)/2=1, avgLoss=(0+1)/2=0.5 → RS=2 → 66.6667
    // i=3: gain 2 → avgGain=(1·1+2)/2=1.5, avgLoss=(0.5·1+0)/2=0.25 → RS=6 → 85.7143
    // i=4: no change → avgGain=0.75, avgLoss=0.125 → RS=6 → 85.7143
    expectSeries(rsi([10, 12, 11, 13, 13], 2), [null, null, 200 / 3, 600 / 7, 600 / 7], 4);
  });

  it("matches a hand-computed 14-period example", () => {
    // 10 rises of +1 and 4 falls of −1 → avgGain=10/14, avgLoss=4/14 → RS=2.5 → RSI=100−100/3.5=71.4286
    const changes = [1, 1, -1, 1, 1, 1, -1, 1, 1, -1, 1, 1, -1, 1];
    const values = [100];
    for (const c of changes) values.push(values.at(-1)! + c);
    // One more +1: avgGain=(10/14·13+1)/14=144/196, avgLoss=(4/14·13)/14=52/196 → RSI=100·144/196=73.4694
    values.push(values.at(-1)! + 1);
    const out = rsi(values); // default period 14
    expect(out.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(out[14]).toBeCloseTo(100 - 100 / 3.5, 4);
    expect(out[15]).toBeCloseTo((100 * 144) / 196, 4);
  });

  it("is consistent with the widely cited StockCharts example (within 0.1)", () => {
    // Commonly reproduced 14-day example (first RSI 70.53). The reference is a spreadsheet whose
    // intermediate values are rounded, so it differs from exact arithmetic by < 0.1 points.
    const c = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03,
      46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13,
    ];
    const reference = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77];
    const out = rsi(c, 14).slice(14);
    reference.forEach((r, i) => expect(Math.abs((out[i] as number) - r), `day ${i + 14}`).toBeLessThan(0.1));
  });

  it("needs period + 1 values", () => {
    expect(rsi(Array.from({ length: 14 }, (_, i) => i), 14).every((v) => v === null)).toBe(true);
    expect(rsi(Array.from({ length: 15 }, (_, i) => i), 14)[14]).not.toBeNull();
    expect(rsi([], 14)).toEqual([]);
    expect(rsi([5], 1)).toEqual([null]);
  });

  it("handles one-directional and flat markets", () => {
    expect(latestValue(rsi([1, 2, 3, 4, 5], 3))).toBe(100); // only gains
    expect(latestValue(rsi([5, 4, 3, 2, 1], 3))).toBe(0); // only losses
    expect(latestValue(rsi([3, 3, 3, 3, 3], 3))).toBe(50); // no movement → neutral, not NaN
  });

  it("stays within 0–100 on noisy data", () => {
    let x = 100;
    const values = Array.from({ length: 500 }, (_, i) => (x += Math.sin(i * 1.7) * 3 + Math.cos(i * 0.3)));
    for (const v of rsi(values)) if (v !== null) expect(v >= 0 && v <= 100).toBe(true);
  });
});

describe("input validation", () => {
  it("rejects non-integer or non-positive periods", () => {
    for (const p of [0, -3, 2.5, Number.NaN]) {
      expect(() => sma([1, 2, 3], p)).toThrow(RangeError);
      expect(() => ema([1, 2, 3], p)).toThrow(RangeError);
      expect(() => rsi([1, 2, 3], p)).toThrow(RangeError);
    }
  });

  it("rejects non-finite values instead of producing NaN", () => {
    expect(() => sma([1, Number.NaN, 3], 2)).toThrow(/index 1/);
    expect(() => ema([1, 2, Infinity], 2)).toThrow(RangeError);
    expect(() => rsi([1, 2, -Infinity, 4], 2)).toThrow(RangeError);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6];
    const copy = [...values];
    sma(values, 3);
    ema(values, 3);
    rsi(values, 3);
    expect(values).toEqual(copy);
  });
});

describe("helpers with existing bar types", () => {
  const bar = (time: string, close: number): BarDTO => ({
    time,
    timestamp: `${time}T03:45:00.000Z`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  });
  const bars = [bar("2026-11-23", 10), bar("2026-11-24", 20), bar("2026-11-25", 30)];

  it("extracts closes and pairs values with trading dates", () => {
    expect(closes(bars)).toEqual([10, 20, 30]);
    expect(toIndicatorSeries(bars, sma(closes(bars), 2))).toEqual([
      { time: "2026-11-23", value: null },
      { time: "2026-11-24", value: 15 },
      { time: "2026-11-25", value: 25 },
    ]);
  });

  it("rejects mismatched lengths", () => {
    expect(() => toIndicatorSeries(bars, [1, 2])).toThrow(RangeError);
  });

  it("latestValue skips warm-up nulls and handles empty series", () => {
    expect(latestValue([null, 1, 2])).toBe(2);
    expect(latestValue([null, null])).toBeNull();
    expect(latestValue([])).toBeNull();
  });
});
