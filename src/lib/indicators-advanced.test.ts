import { describe, expect, it } from "vitest";
import { analyzeVolume, bollingerBands, closes, ema, macd, sma, volumes, type IndicatorValue } from "./indicators";
import type { BarDTO } from "./types";

function expectSeries(actual: IndicatorValue[], expected: IndicatorValue[], digits = 6) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    if (e === null) expect(actual[i], `index ${i}`).toBeNull();
    else expect(actual[i], `index ${i}`).toBeCloseTo(e, digits);
  });
}

describe("macd", () => {
  it("matches a hand-computed example (fast 2, slow 3, signal 2)", () => {
    // values: 2, 4, 6, 8, 12, 9, 3
    // EMA2 (k=2/3): –, 3, 5, 7, 31/3, 85/9, 139/27
    // EMA3 (k=1/2): –, –, 4, 6, 9, 9, 6
    // MACD:         –, –, 1, 1, 4/3, 4/9, −23/27
    // signal = EMA2 of MACD, seeded at index 3 with (1+1)/2 = 1:
    //               –, –, –, 1, 11/9, 19/27, −1/3
    // histogram:    –, –, –, 0, 1/9, −7/27, −14/27
    const r = macd([2, 4, 6, 8, 12, 9, 3], 2, 3, 2);
    expectSeries(r.macd, [null, null, 1, 1, 4 / 3, 4 / 9, -23 / 27]);
    expectSeries(r.signal, [null, null, null, 1, 11 / 9, 19 / 27, -1 / 3]);
    expectSeries(r.histogram, [null, null, null, 0, 1 / 9, -7 / 27, -14 / 27]);
  });

  it("is built from the existing ema(): MACD line = EMA12 − EMA26", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 5 + i * 0.2);
    const r = macd(values);
    const e12 = ema(values, 12);
    const e26 = ema(values, 26);
    for (let i = 25; i < values.length; i++) expect(r.macd[i]).toBeCloseTo((e12[i] as number) - (e26[i] as number), 10);
  });

  it("uses default (12, 26, 9) warm-up: MACD from index 25, signal from index 33", () => {
    const values = Array.from({ length: 40 }, (_, i) => 50 + i);
    const r = macd(values);
    expect(r.macd.findIndex((v) => v !== null)).toBe(25);
    expect(r.signal.findIndex((v) => v !== null)).toBe(33);
    expect(r.histogram.findIndex((v) => v !== null)).toBe(33);
  });

  it("is zero for a constant series", () => {
    const r = macd(Array(40).fill(100));
    expect(r.macd[39]).toBeCloseTo(0, 12);
    expect(r.signal[39]).toBeCloseTo(0, 12);
    expect(r.histogram[39]).toBeCloseTo(0, 12);
  });

  it("is positive in a steady uptrend and negative in a steady downtrend", () => {
    const up = macd(Array.from({ length: 50 }, (_, i) => 100 + i));
    const down = macd(Array.from({ length: 50 }, (_, i) => 200 - i));
    expect(up.macd[49]).toBeGreaterThan(0);
    expect(down.macd[49]).toBeLessThan(0);
  });

  it("handles insufficient data", () => {
    const short = macd(Array.from({ length: 25 }, (_, i) => i)); // one short of the slow EMA
    expect(short.macd.every((v) => v === null)).toBe(true);
    expect(short.signal.every((v) => v === null)).toBe(true);
    const noSignal = macd(Array.from({ length: 30 }, (_, i) => i)); // MACD yes, signal not yet
    expect(noSignal.macd[29]).not.toBeNull();
    expect(noSignal.signal.every((v) => v === null)).toBe(true);
    expect(macd([])).toEqual({ macd: [], signal: [], histogram: [] });
  });

  it("validates periods", () => {
    expect(() => macd([1, 2, 3], 26, 12)).toThrow(/shorter/);
    expect(() => macd([1, 2, 3], 12, 12)).toThrow(RangeError);
    expect(() => macd([1, 2, 3], 0, 26)).toThrow(RangeError);
    expect(() => macd([1, 2, 3], 12, 26, 1.5)).toThrow(RangeError);
    expect(() => macd([1, Number.NaN, 3], 1, 2, 1)).toThrow(RangeError);
  });
});

describe("bollingerBands", () => {
  it("matches a hand-computed example (period 2, k = 2)", () => {
    // [1,3]: mean 2, σ = 1 → 4 / 0;  [3,5]: mean 4, σ = 1 → 6 / 2;  [5,5]: σ = 0 → 5 / 5
    const r = bollingerBands([1, 3, 5, 5], 2, 2);
    expectSeries(r.middle, [null, 2, 4, 5]);
    expectSeries(r.upper, [null, 4, 6, 5]);
    expectSeries(r.lower, [null, 0, 2, 5]);
  });

  it("uses the population σ with default (20, 2): values 1…20", () => {
    // mean 10.5; population variance of 1..n = (n² − 1)/12 = 33.25 → σ = 5.766281
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const r = bollingerBands(values);
    const sd = Math.sqrt(33.25);
    expect(r.middle[19]).toBeCloseTo(10.5, 10);
    expect(r.upper[19]).toBeCloseTo(10.5 + 2 * sd, 10); // 22.032563
    expect(r.lower[19]).toBeCloseTo(10.5 - 2 * sd, 10); // −1.032563
    expect(r.upper[19]).toBeCloseTo(22.032563, 6);
    expect(r.middle.slice(0, 19).every((v) => v === null)).toBe(true);
  });

  it("middle band is the existing sma()", () => {
    const values = [5, 7, 6, 9, 11, 10, 8];
    expect(bollingerBands(values, 3).middle).toEqual(sma(values, 3));
  });

  it("collapses to the mean when there is no volatility, and k = 0 gives a single line", () => {
    const flat = bollingerBands(Array(25).fill(42));
    expect(flat.upper[24]).toBe(42);
    expect(flat.lower[24]).toBe(42);
    const r = bollingerBands([1, 3, 5, 5], 2, 0);
    expect(r.upper).toEqual(r.middle);
  });

  it("stays numerically stable on high-priced, low-volatility data", () => {
    // Prices around 1e7 with ±0.01 moves: running-sum variance would lose precision here.
    const values = Array.from({ length: 20 }, (_, i) => 10_000_000 + (i % 2 ? 0.01 : -0.01));
    const r = bollingerBands(values);
    expect(r.upper[19]! - r.middle[19]!).toBeCloseTo(0.02, 6); // 2 × σ(0.01)
  });

  it("handles insufficient data and validates input", () => {
    const r = bollingerBands([1, 2, 3], 20);
    expect([...r.middle, ...r.upper, ...r.lower].every((v) => v === null)).toBe(true);
    expect(bollingerBands([])).toEqual({ middle: [], upper: [], lower: [] });
    expect(() => bollingerBands([1, 2], 0)).toThrow(RangeError);
    expect(() => bollingerBands([1, 2], 2, -1)).toThrow(RangeError);
    expect(() => bollingerBands([1, 2], 2, Number.NaN)).toThrow(RangeError);
    expect(() => bollingerBands([1, Infinity], 2)).toThrow(RangeError);
  });
});

describe("analyzeVolume", () => {
  it("matches a hand-computed example (period 4, threshold 2)", () => {
    // average (incl. today): idx3 = 100, idx4 = (100·3+300)/4 = 150, idx5 = (100·2+300+50)/4 = 137.5
    // relative (vs previous 4): idx4 = 300/100 = 3 → spike; idx5 = 50/150 = 1/3
    const r = analyzeVolume([100, 100, 100, 100, 300, 50], 4, 2);
    expectSeries(r.averageVolume, [null, null, null, 100, 150, 137.5]);
    expectSeries(r.relativeVolume, [null, null, null, null, 3, 1 / 3]);
    expect(r.isSpike).toEqual([null, null, null, null, true, false]);
  });

  it("excludes today from the baseline, so a spike does not dilute itself", () => {
    const r = analyzeVolume([10, 10, 30], 2, 3);
    expect(r.relativeVolume[2]).toBe(3); // 30 / mean(10, 10), not 30 / mean(10, 30)
    expect(r.isSpike[2]).toBe(true); // threshold is inclusive
  });

  it("uses default period 20 and threshold 2", () => {
    const vols = [...Array(20).fill(1000), 1999, 2100];
    const r = analyzeVolume(vols);
    expect(r.relativeVolume[19]).toBeNull(); // only 19 prior bars
    // idx20: 1999 / mean(1000 × 20) = 1.999 → just below the threshold
    expect(r.relativeVolume[20]).toBeCloseTo(1.999, 10);
    expect(r.isSpike[20]).toBe(false);
    // idx21: baseline = (1000 × 19 + 1999) / 20 = 1049.95 → 2100 / 1049.95 = 2.000095 → spike
    expect(r.relativeVolume[21]).toBeCloseTo(2100 / 1049.95, 10);
    expect(r.isSpike[21]).toBe(true);
  });

  it("returns null (not Infinity) when the prior average is zero, e.g. indices", () => {
    const r = analyzeVolume([0, 0, 0, 0, 500], 4);
    expect(r.averageVolume[4]).toBe(125);
    expect(r.relativeVolume[4]).toBeNull();
    expect(r.isSpike[4]).toBeNull();
  });

  it("handles insufficient data and validates input", () => {
    const r = analyzeVolume([100, 200], 20);
    expect(r.averageVolume).toEqual([null, null]);
    expect(r.isSpike).toEqual([null, null]);
    expect(analyzeVolume([])).toEqual({ averageVolume: [], relativeVolume: [], isSpike: [] });
    expect(() => analyzeVolume([100, -1], 1)).toThrow(/negative/);
    expect(() => analyzeVolume([100, Number.NaN], 1)).toThrow(RangeError);
    expect(() => analyzeVolume([1, 2], 0)).toThrow(RangeError);
    expect(() => analyzeVolume([1, 2], 1, 0)).toThrow(RangeError);
  });
});

describe("helpers with existing bar types", () => {
  const bar = (time: string, close: number, volume: number): BarDTO => ({
    time,
    timestamp: `${time}T14:30:00.000Z`,
    open: close,
    high: close,
    low: close,
    close,
    volume,
  });

  it("feeds BarDTO[] through closes() / volumes()", () => {
    const bars = [bar("2026-11-23", 10, 100), bar("2026-11-24", 12, 100), bar("2026-11-25", 11, 400)];
    expect(volumes(bars)).toEqual([100, 100, 400]);
    expect(bollingerBands(closes(bars), 2).middle).toEqual([null, 11, 11.5]);
    expect(analyzeVolume(volumes(bars), 2).isSpike).toEqual([null, null, true]);
  });
});
