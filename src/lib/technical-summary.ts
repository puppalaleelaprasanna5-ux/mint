/**
 * Combines the indicator, trend and risk engines into one serializable snapshot for the
 * instrument page. Pure: no I/O. Every value describes historical prices only.
 */
import { analyzeVolume, bollingerBands, closes, ema, macd, rsi, sma, volumes } from "./indicators";
import { analyzeRisk, type BenchmarkInput, type RiskAnalysis } from "./risk-analysis";
import { analyzeTrend, type TrendAnalysis } from "./trend-analysis";
import type { BarDTO } from "./types";

export interface IndicatorReading {
  value: number | null;
  /** Bars needed before the value exists. */
  requiredBars: number;
}

export interface TechnicalSnapshot {
  close: number;
  sma20: IndicatorReading;
  sma50: IndicatorReading;
  sma200: IndicatorReading;
  ema12: IndicatorReading;
  ema26: IndicatorReading;
  rsi14: IndicatorReading;
  macd: { macd: number | null; signal: number | null; histogram: number | null; requiredBars: number };
  bollinger: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
    /** Where the close sits in the band: 0 = lower band, 1 = upper band (can go outside 0–1). */
    percentB: number | null;
    /** (upper − lower) / middle — how wide the band is relative to price. */
    bandwidth: number | null;
    requiredBars: number;
  };
  volume: {
    /** False for instruments that report no volume (indices). */
    available: boolean;
    latest: number;
    average20: number | null;
    relative: number | null;
    /** Volume spikes (≥ 2× the prior 20-day average) in the last 20 sessions. */
    spikesLast20: number;
    lastSpikeDate: string | null;
    requiredBars: number;
  };
}

export interface TechnicalSummary {
  asOf: string | null;
  barsAnalyzed: number;
  isSimulated: boolean;
  snapshot: TechnicalSnapshot | null;
  trend: TrendAnalysis | null;
  risk: RiskAnalysis | null;
  /** Set if an engine rejected the data (e.g. a non-positive price). */
  error: string | null;
}

const reading = (series: (number | null)[], requiredBars: number): IndicatorReading => ({
  value: series.length ? series[series.length - 1] : null,
  requiredBars,
});

function buildSnapshot(bars: readonly BarDTO[]): TechnicalSnapshot {
  const c = closes(bars);
  const last = c.length - 1;
  const bb = bollingerBands(c, 20, 2);
  const upper = bb.upper[last] ?? null;
  const middle = bb.middle[last] ?? null;
  const lower = bb.lower[last] ?? null;
  const m = macd(c, 12, 26, 9);

  const vols = volumes(bars);
  const hasVolume = vols.some((v) => v > 0);
  const va = analyzeVolume(vols, 20, 2);
  let spikes = 0;
  let lastSpikeDate: string | null = null;
  for (let i = Math.max(0, vols.length - 20); i < vols.length; i++) {
    if (va.isSpike[i]) {
      spikes++;
      lastSpikeDate = bars[i].time;
    }
  }

  return {
    close: c[last],
    sma20: reading(sma(c, 20), 20),
    sma50: reading(sma(c, 50), 50),
    sma200: reading(sma(c, 200), 200),
    ema12: reading(ema(c, 12), 12),
    ema26: reading(ema(c, 26), 26),
    rsi14: reading(rsi(c, 14), 15),
    macd: { macd: m.macd[last], signal: m.signal[last], histogram: m.histogram[last], requiredBars: 34 },
    bollinger: {
      upper,
      middle,
      lower,
      percentB: upper !== null && lower !== null && upper !== lower ? (c[last] - lower) / (upper - lower) : null,
      bandwidth: upper !== null && lower !== null && middle ? (upper - lower) / middle : null,
      requiredBars: 20,
    },
    volume: {
      available: hasVolume,
      latest: vols[last],
      average20: hasVolume ? va.averageVolume[last] : null,
      relative: hasVolume ? va.relativeVolume[last] : null,
      spikesLast20: spikes,
      lastSpikeDate,
      requiredBars: 21,
    },
  };
}

function withSelfBenchmark(risk: RiskAnalysis, selfName: string | null): RiskAnalysis {
  if (!selfName) return risk;
  return {
    ...risk,
    beta: {
      value: null,
      status: "unavailable",
      benchmark: selfName,
      overlap: 0,
      explanation: `Not applicable: this index is the benchmark (${selfName}) that beta is measured against.`,
    },
  };
}

export function buildTechnicalSummary(
  bars: readonly BarDTO[],
  /** benchmarkIsSelf: the instrument IS the benchmark index, so beta would trivially be 1. */
  options: { isSimulated: boolean; benchmark?: BenchmarkInput | null; benchmarkIsSelf?: boolean },
): TechnicalSummary {
  const base = {
    asOf: bars.length ? bars[bars.length - 1].time : null,
    barsAnalyzed: bars.length,
    isSimulated: options.isSimulated,
  };
  if (bars.length === 0) return { ...base, snapshot: null, trend: null, risk: null, error: null };
  try {
    return {
      ...base,
      snapshot: buildSnapshot(bars),
      trend: analyzeTrend(bars),
      risk: withSelfBenchmark(
        analyzeRisk(bars, { isSimulated: options.isSimulated, benchmark: options.benchmarkIsSelf ? null : (options.benchmark ?? null) }),
        options.benchmarkIsSelf ? (options.benchmark?.name ?? "the benchmark") : null,
      ),
      error: null,
    };
  } catch (err) {
    if (err instanceof RangeError) {
      return { ...base, snapshot: null, trend: null, risk: null, error: err.message };
    }
    throw err;
  }
}

