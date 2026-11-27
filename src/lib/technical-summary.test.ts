import { describe, expect, it } from "vitest";
import { buildTechnicalSummary } from "./technical-summary";
import { bollingerBands, ema, latestValue, macd, rsi, sma } from "./indicators";
import { analyzeRisk } from "./risk-analysis";
import { addDays, isWeekend } from "./time";
import type { BarDTO } from "./types";

function bars(closes: number[], volume: (i: number) => number = () => 1000): BarDTO[] {
  const out: BarDTO[] = [];
  let d = "2025-01-06";
  closes.forEach((close, i) => {
    while (isWeekend(d)) d = addDays(d, 1);
    out.push({ time: d, timestamp: `${d}T03:45:00.000Z`, open: close, high: close * 1.01, low: close * 0.99, close, volume: volume(i) });
    d = addDays(d, 1);
  });
  return out;
}
const wave = (n: number) => Array.from({ length: n }, (_, i) => 100 + i * 0.1 + 5 * Math.sin(i / 7));

describe("buildTechnicalSummary", () => {
  it("returns an empty summary (no throw) for no bars", () => {
    const s = buildTechnicalSummary([], { isSimulated: false });
    expect(s).toEqual({ asOf: null, barsAnalyzed: 0, isSimulated: false, snapshot: null, trend: null, risk: null, error: null });
  });

  it("matches the underlying indicator engines on the latest bar", () => {
    const c = wave(260);
    const s = buildTechnicalSummary(bars(c), { isSimulated: true });
    const snap = s.snapshot!;
    expect(snap.close).toBe(c[259]);
    expect(snap.sma20.value).toBeCloseTo(latestValue(sma(c, 20))!, 12);
    expect(snap.sma200.value).toBeCloseTo(latestValue(sma(c, 200))!, 12);
    expect(snap.ema12.value).toBeCloseTo(latestValue(ema(c, 12))!, 12);
    expect(snap.rsi14.value).toBeCloseTo(latestValue(rsi(c, 14))!, 12);
    const m = macd(c);
    expect(snap.macd.histogram).toBeCloseTo(m.histogram[259]!, 12);
    const bb = bollingerBands(c);
    expect(snap.bollinger.upper).toBeCloseTo(bb.upper[259]!, 12);
    expect(s.isSimulated).toBe(true);
    expect(s.trend?.asOf).toBe(s.asOf);
    expect(s.risk?.cautions[0]).toMatch(/SIMULATED/);
  });

  it("computes Bollinger %B and bandwidth by hand", () => {
    // 20 closes alternating 99 / 101 → mean 100, σ = 1 → bands 98 / 102; last close 101 → %B = 0.75
    const c = Array.from({ length: 20 }, (_, i) => (i % 2 ? 101 : 99));
    const b = buildTechnicalSummary(bars(c), { isSimulated: false }).snapshot!.bollinger;
    expect(b.upper).toBeCloseTo(102, 12);
    expect(b.lower).toBeCloseTo(98, 12);
    expect(b.percentB).toBeCloseTo(0.75, 12);
    expect(b.bandwidth).toBeCloseTo(0.04, 12);
  });

  it("reports %B as null when the bands are flat", () => {
    const b = buildTechnicalSummary(bars(Array(25).fill(50)), { isSimulated: false }).snapshot!.bollinger;
    expect(b.middle).toBe(50);
    expect(b.percentB).toBeNull();
  });

  it("leaves long indicators null with short history, keeping what is available", () => {
    const s = buildTechnicalSummary(bars(wave(30)), { isSimulated: false });
    const snap = s.snapshot!;
    expect(snap.sma20.value).not.toBeNull();
    expect(snap.sma50).toEqual({ value: null, requiredBars: 50 });
    expect(snap.sma200.value).toBeNull();
    expect(snap.macd.macd).not.toBeNull();
    expect(snap.macd.signal).toBeNull(); // needs 34
    expect(s.trend?.longTerm.direction).toBe("insufficient_data");
  });

  it("marks volume unavailable for indices (zero volume)", () => {
    const v = buildTechnicalSummary(bars(wave(40), () => 0), { isSimulated: false }).snapshot!.volume;
    expect(v).toMatchObject({ available: false, average20: null, relative: null, spikesLast20: 0 });
  });

  it("counts volume spikes in the last 20 sessions", () => {
    // Normal 1000/day; 3× spikes on bars 30 and 35 (both within the last 20 of 40)
    const s = buildTechnicalSummary(bars(wave(40), (i) => (i === 30 || i === 35 ? 3000 : 1000)), { isSimulated: false });
    const v = s.snapshot!.volume;
    expect(v.spikesLast20).toBe(2);
    expect(v.lastSpikeDate).toBe(bars(wave(40))[35].time);
    // 20-day average over bars 20–39 includes both spikes: (18 × 1000 + 2 × 3000) / 20 = 1200
    expect(v.average20).toBeCloseTo(1200, 12);
  });

  it("passes the benchmark through to beta", () => {
    const c = wave(120);
    const real = buildTechnicalSummary(bars(c), { isSimulated: false, benchmark: { name: "Index", bars: bars(c), isSimulated: false } });
    expect(real.risk?.beta.value).toBeCloseTo(1, 10); // identical series → β = 1
    const sim = buildTechnicalSummary(bars(c), { isSimulated: false, benchmark: { name: "Index", bars: bars(c), isSimulated: true } });
    expect(sim.risk?.beta.status).toBe("unavailable");
    expect(real.risk?.volatility.value).toBeCloseTo(analyzeRisk(bars(c)).volatility.value!, 12);
  });

  it("reports beta as not applicable when the instrument is the benchmark itself", () => {
    const c = wave(120);
    const s = buildTechnicalSummary(bars(c), {
      isSimulated: false,
      benchmark: { name: "NIFTY 50", bars: bars(c), isSimulated: false },
      benchmarkIsSelf: true,
    });
    expect(s.risk?.beta).toMatchObject({ value: null, status: "unavailable", benchmark: "NIFTY 50" });
    expect(s.risk?.beta.explanation).toMatch(/Not applicable: this index is the benchmark/);
  });

  it("turns invalid data into an error message instead of crashing the page", () => {
    const b = bars(wave(30));
    b[10] = { ...b[10], close: -5 };
    const s = buildTechnicalSummary(b, { isSimulated: false });
    expect(s.snapshot).toBeNull();
    expect(s.error).toMatch(/positive|finite/);
  });
});
