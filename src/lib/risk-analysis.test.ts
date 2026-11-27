import { describe, expect, it } from "vitest";
import {
  alignedReturns,
  analyzeRisk,
  beta,
  dailyReturns,
  downsideDeviation,
  drawdownLevel,
  maxDrawdown,
  mean,
  RISK_DISCLAIMER,
  sampleStdDev,
  volatilityLevel,
  type RiskBar,
} from "./risk-analysis";
import { addDays, isWeekend } from "./time";
import type { BarDTO } from "./types";

const SQRT252 = Math.sqrt(252);

/** Bars on consecutive weekdays from 2026-01-05 (a Monday). */
function bars(closes: number[], start = "2026-01-05"): RiskBar[] {
  const out: RiskBar[] = [];
  let d = start;
  for (const close of closes) {
    while (isWeekend(d)) d = addDays(d, 1);
    out.push({ time: d, close });
    d = addDays(d, 1);
  }
  return out;
}
const loose = { minReturns: 2, minBetaOverlap: 2 };

describe("building blocks (hand-calculated)", () => {
  // closes 100 → 110 → 99 → 99: returns +10%, −10%, 0%
  const closes = [100, 110, 99, 99];

  it("daily returns and their mean", () => {
    const r = dailyReturns(closes);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(-0.1, 12);
    expect(r[2]).toBeCloseTo(0, 12);
    expect(mean(r)).toBeCloseTo(0, 12);
  });

  it("sample standard deviation: var = (0.01 + 0.01 + 0) / (3 − 1) = 0.01 → σ = 0.1", () => {
    expect(sampleStdDev(dailyReturns(closes))).toBeCloseTo(0.1, 12);
    expect(sampleStdDev([5])).toBeNull();
    expect(sampleStdDev([])).toBeNull();
  });

  it("downside deviation: √((0 + 0.01 + 0) / 3) = 0.057735", () => {
    expect(downsideDeviation(dailyReturns(closes))).toBeCloseTo(Math.sqrt(0.01 / 3), 12);
    expect(downsideDeviation([0.02, 0.01])).toBe(0); // no down days
    expect(downsideDeviation([])).toBeNull();
    // target 1%/day: shortfalls −0.01, −0.005 and 0 over all 3 returns → √((0.0001 + 0.000025 + 0) / 3)
    expect(downsideDeviation([0, 0.005, 0.02], 0.01)).toBeCloseTo(Math.sqrt((0.0001 + 0.000025) / 3), 12);
  });

  it("maximum drawdown: 110 → 99 is a 10% fall, not recovered", () => {
    expect(maxDrawdown(closes)).toEqual({ maxDrawdown: expect.closeTo(0.1, 12), peakIndex: 1, troughIndex: 2, recoveryIndex: null });
  });

  it("maximum drawdown picks the deepest fall and finds the recovery", () => {
    // 100 → 120 → 90 (−25%) → 130 (recovered) → 117 (−10%)
    const r = maxDrawdown([100, 120, 90, 130, 117]);
    expect(r).toMatchObject({ peakIndex: 1, troughIndex: 2, recoveryIndex: 3 });
    expect(r?.maxDrawdown).toBeCloseTo(0.25, 12);
  });

  it("maximum drawdown is 0 for a rising series and null without history", () => {
    expect(maxDrawdown([1, 2, 3])?.maxDrawdown).toBe(0);
    expect(maxDrawdown([5])).toBeNull();
  });

  it("beta: asset returns exactly 2× the benchmark → β = 2; −1× → β = −1", () => {
    const b = [0.01, -0.02, 0.03];
    expect(beta(b.map((x) => 2 * x), b)).toBeCloseTo(2, 12);
    expect(beta(b.map((x) => -x), b)).toBeCloseTo(-1, 12);
    expect(beta([0.01, 0.02], [0.01, 0.01])).toBeNull(); // benchmark never varies
    expect(() => beta([1], [1, 2])).toThrow(RangeError);
  });

  it("alignedReturns only pairs consecutive dates present in both series", () => {
    const asset = bars([100, 110, 121, 133.1]); // Mon–Thu
    const bench = [asset[0], asset[2], asset[3]].map((b, i) => ({ time: b.time, close: [50, 60, 66][i] })); // no Tuesday
    const a = alignedReturns(asset, bench);
    expect(a.dates).toEqual([asset[2].time, asset[3].time]);
    expect(a.asset[0]).toBeCloseTo(0.21, 12); // Mon → Wed, 100 → 121
    expect(a.benchmark[0]).toBeCloseTo(0.2, 12); // 50 → 60
  });

  it("risk level thresholds", () => {
    expect([0.1, 0.15, 0.29, 0.3, 0.5].map(volatilityLevel)).toEqual(["low", "moderate", "moderate", "high", "very_high"]);
    expect([0.05, 0.1, 0.2, 0.35].map(drawdownLevel)).toEqual(["low", "moderate", "high", "very_high"]);
  });
});

describe("analyzeRisk", () => {
  it("reports the hand-calculated example end to end", () => {
    const r = analyzeRisk(bars([100, 110, 99, 99]), loose);
    expect(r.returnsAnalyzed).toBe(3);
    expect(r.averageDailyReturn.value).toBeCloseTo(0, 12);
    expect(r.totalReturn.value).toBeCloseTo(-0.01, 12);
    expect(r.volatility.daily).toBeCloseTo(0.1, 12);
    expect(r.volatility.value).toBeCloseTo(0.1 * SQRT252, 10); // 158.7%
    expect(r.downsideDeviation.value).toBeCloseTo(Math.sqrt(0.01 / 3) * SQRT252, 10); // 91.7%
    expect(r.maxDrawdown).toMatchObject({ value: expect.closeTo(0.1, 12), peakDate: "2026-01-06", troughDate: "2026-01-07", recoveredDate: null });
    expect(r.riskLevel).toBe("very_high"); // volatility very high, drawdown moderate → worse of the two
    expect(r.riskExplanation).toMatch(/whichever is higher/);
  });

  it("calm series: low risk with readable explanations", () => {
    // Alternating +0.5% / −0.5%-ish moves for 300 days
    const closes = Array.from({ length: 300 }, (_, i) => (i % 2 ? 100.5 : 100));
    const r = analyzeRisk(bars(closes));
    expect(r.volatility.status).toBe("ok");
    expect(r.volatility.value!).toBeLessThan(0.15);
    expect(r.maxDrawdown.value).toBeCloseTo(1 - 100 / 100.5, 10);
    expect(r.riskLevel).toBe("low");
    expect(r.volatility.explanation).toMatch(/\(low\)/);
    expect(r.cautions).toEqual([]); // ≥ 1 year, no gaps, not simulated
  });

  it("zero volatility: every metric is 0 with an explanation, not NaN", () => {
    const r = analyzeRisk(bars(Array(30).fill(250)));
    expect(r.volatility).toMatchObject({ value: 0, daily: 0, status: "ok" });
    expect(r.volatility.explanation).toMatch(/did not change at all/);
    expect(r.downsideDeviation).toMatchObject({ value: 0, status: "ok" });
    expect(r.maxDrawdown).toMatchObject({ value: 0, peakDate: null });
    expect(r.averageDailyReturn.value).toBe(0);
    expect(r.riskLevel).toBe("low");
    expect(r.riskExplanation).toMatch(/check the data/);
  });

  it("only rising days: downside deviation is 0", () => {
    const r = analyzeRisk(bars(Array.from({ length: 30 }, (_, i) => 100 + i)));
    expect(r.downsideDeviation.value).toBe(0);
    expect(r.downsideDeviation.explanation).toMatch(/no down days/);
    expect(r.maxDrawdown.value).toBe(0);
  });

  it("insufficient history: metrics say what they need", () => {
    const none = analyzeRisk([]);
    expect(none).toMatchObject({ asOf: null, barsAnalyzed: 0, returnsAnalyzed: 0, riskLevel: "insufficient_data" });
    expect(none.averageDailyReturn.status).toBe("insufficient_data");
    expect(none.maxDrawdown.status).toBe("insufficient_data");

    const one = analyzeRisk(bars([100]));
    expect(one.totalReturn.status).toBe("insufficient_data");

    const short = analyzeRisk(bars([100, 101, 99, 102, 103])); // 4 returns < default 20
    expect(short.averageDailyReturn.status).toBe("ok"); // needs just 1 return
    expect(short.maxDrawdown.status).toBe("ok");
    expect(short.volatility).toMatchObject({ value: null, status: "insufficient_data" });
    expect(short.volatility.explanation).toMatch(/needs 20 daily returns, 4 available/);
    expect(short.downsideDeviation.status).toBe("insufficient_data");
    expect(short.riskLevel).toBe("insufficient_data");
    expect(short.cautions.join(" ")).toMatch(/less than a year/);
  });

  it("missing days: gaps are reported, and returns span the available bars", () => {
    const r = analyzeRisk(
      [
        { time: "2026-01-05", close: 100 },
        { time: "2026-01-06", close: 102 },
        { time: "2026-01-26", close: 90 }, // 20-day gap
        { time: "2026-01-27", close: 91 },
      ],
      loose,
    );
    expect(r.returnsAnalyzed).toBe(3);
    expect(r.cautions.join(" ")).toMatch(/1 gap longer than 7 days/);
  });

  it("flags simulated prices", () => {
    const r = analyzeRisk(bars([100, 101, 102]), { ...loose, isSimulated: true });
    expect(r.cautions[0]).toMatch(/SIMULATED/);
  });

  it("rejects invalid input", () => {
    expect(() => analyzeRisk(bars([100, 0, 101]))).toThrow(/positive finite/);
    expect(() => analyzeRisk(bars([100, Number.NaN]))).toThrow(RangeError);
    expect(() => analyzeRisk([{ time: "2026-01-06", close: 1 }, { time: "2026-01-05", close: 1 }])).toThrow(/ascending/);
    expect(() => analyzeRisk(bars([1, 2]), { minReturns: 1 })).toThrow(RangeError);
  });

  it("accepts BarDTO[] from the price service directly", () => {
    const dto: BarDTO[] = bars([100, 110, 99, 99]).map((b) => ({
      ...b,
      timestamp: `${b.time}T03:45:00.000Z`,
      open: b.close,
      high: b.close,
      low: b.close,
      volume: 0,
    }));
    expect(analyzeRisk(dto, loose).volatility.daily).toBeCloseTo(0.1, 12);
  });

  it("always includes the disclaimer", () => {
    expect(analyzeRisk([]).disclaimer).toBe(RISK_DISCLAIMER);
  });
});

describe("analyzeRisk — beta", () => {
  // Benchmark returns +1%, −2%, +3%; asset returns exactly double.
  const benchCloses = [100, 101, 101 * 0.98, 101 * 0.98 * 1.03];
  const assetCloses = [100, 102, 102 * 0.96, 102 * 0.96 * 1.06];

  it("is computed against a real benchmark (hand-calculated β = 2)", () => {
    const r = analyzeRisk(bars(assetCloses), {
      ...loose,
      benchmark: { name: "NIFTY 50", bars: bars(benchCloses), isSimulated: false },
    });
    expect(r.beta).toMatchObject({ status: "ok", benchmark: "NIFTY 50", overlap: 3 });
    expect(r.beta.value).toBeCloseTo(2, 10);
    expect(r.beta.explanation).toMatch(/move more than NIFTY 50/);
  });

  it("is unavailable without a benchmark", () => {
    expect(analyzeRisk(bars(assetCloses), loose).beta).toMatchObject({ value: null, status: "unavailable", benchmark: null });
  });

  it("is unavailable against a simulated benchmark", () => {
    const r = analyzeRisk(bars(assetCloses), { ...loose, benchmark: { name: "S&P 500", bars: bars(benchCloses), isSimulated: true } });
    expect(r.beta).toMatchObject({ value: null, status: "unavailable" });
    expect(r.beta.explanation).toMatch(/simulated/);
  });

  it("is unavailable when the asset itself is simulated, even against a real benchmark", () => {
    const r = analyzeRisk(bars(assetCloses), {
      ...loose,
      isSimulated: true,
      benchmark: { name: "NIFTY 50", bars: bars(benchCloses), isSimulated: false },
    });
    expect(r.beta).toMatchObject({ value: null, status: "unavailable", benchmark: "NIFTY 50" });
    expect(r.beta.explanation).toMatch(/instrument.s prices are simulated/);
  });

  it("needs enough shared dates (default 60)", () => {
    const r = analyzeRisk(bars(assetCloses), { benchmark: { name: "NIFTY 50", bars: bars(benchCloses), isSimulated: false } });
    expect(r.beta).toMatchObject({ value: null, status: "insufficient_data", overlap: 3 });
    expect(r.beta.explanation).toMatch(/needs 60 daily returns on dates shared with NIFTY 50, only 3/);
  });

  it("does not pair dates that only one series has", () => {
    const r = analyzeRisk(bars(assetCloses), {
      ...loose,
      benchmark: { name: "X", bars: bars(benchCloses, "2027-03-01"), isSimulated: false }, // no common dates
    });
    expect(r.beta).toMatchObject({ status: "insufficient_data", overlap: 0 });
  });

  it("is unavailable when the benchmark never moved", () => {
    const r = analyzeRisk(bars(assetCloses), { ...loose, benchmark: { name: "Flat", bars: bars([50, 50, 50, 50]), isSimulated: false } });
    expect(r.beta).toMatchObject({ value: null, status: "unavailable" });
    expect(r.beta.explanation).toMatch(/did not move/);
  });

  it("validates benchmark bars", () => {
    expect(() =>
      analyzeRisk(bars(assetCloses), { ...loose, benchmark: { name: "Bad", bars: bars([50, -1]), isSimulated: false } }),
    ).toThrow(/Benchmark Bad/);
  });
});
