/**
 * Technical indicators — pure functions over close-price series (oldest → newest).
 *
 * Conventions
 * - Output arrays are aligned with the input: `result[i]` belongs to `values[i]`.
 * - Positions without enough history are `null` (never 0 or NaN), so callers can't mistake
 *   a warm-up period for a real reading.
 * - Invalid input throws a RangeError: a non-integer or < 1 period, or a non-finite value
 *   (NaN/Infinity). Bad data must be fixed upstream, not silently averaged.
 */
import type { CloseLike } from "./quotes";

export type IndicatorValue = number | null;

export interface IndicatorPoint {
  time: string;
  value: IndicatorValue;
}

function assertPeriod(period: number, name: string): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`${name} period must be a positive integer, got ${period}`);
  }
}

function assertFinite(values: readonly number[]): void {
  const i = values.findIndex((v) => !Number.isFinite(v));
  if (i !== -1) throw new RangeError(`Value at index ${i} is not a finite number (${values[i]})`);
}

/**
 * Simple Moving Average: mean of the last `period` values.
 * First value at index `period - 1`.
 */
export function sma(values: readonly number[], period: number): IndicatorValue[] {
  assertPeriod(period, "SMA");
  assertFinite(values);
  const out: IndicatorValue[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential Moving Average with smoothing k = 2 / (period + 1).
 * Seeded with the SMA of the first `period` values (the common charting convention),
 * so the first value is at index `period - 1`.
 */
export function ema(values: readonly number[], period: number): IndicatorValue[] {
  assertPeriod(period, "EMA");
  assertFinite(values);
  const out: IndicatorValue[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Relative Strength Index (Wilder, 1978), range 0–100.
 *
 * - Needs `period + 1` values (`period` price changes); first value at index `period`.
 * - First averages are simple means of the first `period` gains/losses; afterwards Wilder's
 *   smoothing: avg = (prevAvg × (period − 1) + current) / period.
 * - Average loss of 0 gives RSI 100 (only gains). If there was no movement at all (both
 *   averages 0), RSI is undefined; this returns 50 (neutral) instead of dividing by zero.
 */
export function rsi(values: readonly number[], period = 14): IndicatorValue[] {
  assertPeriod(period, "RSI");
  assertFinite(values);
  const out: IndicatorValue[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ───────────────────────────── MACD ─────────────────────────────

export interface MacdResult {
  /** EMA(fast) − EMA(slow). First value at index `slow − 1`. */
  macd: IndicatorValue[];
  /** EMA(signal) of the MACD line. First value at index `slow + signal − 2`. */
  signal: IndicatorValue[];
  /** MACD − signal. */
  histogram: IndicatorValue[];
}

/**
 * Moving Average Convergence/Divergence (Appel), default (12, 26, 9).
 * Each EMA is SMA-seeded, as in `ema()`. The signal line is the EMA of the MACD line
 * starting where the MACD line becomes available.
 */
export function macd(values: readonly number[], fast = 12, slow = 26, signal = 9): MacdResult {
  assertPeriod(fast, "MACD fast");
  assertPeriod(slow, "MACD slow");
  assertPeriod(signal, "MACD signal");
  if (fast >= slow) throw new RangeError(`MACD fast period (${fast}) must be shorter than slow period (${slow})`);
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line: IndicatorValue[] = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || s === null ? null : f - s;
  });

  const start = slow - 1; // first index where the MACD line exists
  const signalLine: IndicatorValue[] = new Array(values.length).fill(null);
  if (values.length > start) {
    const tail = ema(line.slice(start) as number[], signal);
    tail.forEach((v, j) => (signalLine[start + j] = v));
  }
  const histogram = line.map((m, i) => {
    const s = signalLine[i];
    return m === null || s === null ? null : m - s;
  });
  return { macd: line, signal: signalLine, histogram };
}

// ───────────────────────────── Bollinger Bands ─────────────────────────────

export interface BollingerResult {
  middle: IndicatorValue[]; // SMA(period)
  upper: IndicatorValue[]; // middle + k·σ
  lower: IndicatorValue[]; // middle − k·σ
}

/**
 * Bollinger Bands, default (20, 2). σ is the POPULATION standard deviation of the window
 * (divide by N), as defined by John Bollinger. Each window is computed directly rather than
 * from running sums, which avoids catastrophic cancellation on high-priced, low-volatility data.
 */
export function bollingerBands(values: readonly number[], period = 20, multiplier = 2): BollingerResult {
  assertPeriod(period, "Bollinger");
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new RangeError(`Bollinger multiplier must be a finite number ≥ 0, got ${multiplier}`);
  }
  const middle = sma(values, period); // also validates values
  const upper: IndicatorValue[] = new Array(values.length).fill(null);
  const lower: IndicatorValue[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i] as number;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = mean + multiplier * sd;
    lower[i] = mean - multiplier * sd;
  }
  return { middle, upper, lower };
}

// ───────────────────────────── Volume analysis ─────────────────────────────

export interface VolumeAnalysis {
  /** Mean volume of the last `period` bars, including the current one. */
  averageVolume: IndicatorValue[];
  /**
   * Current volume ÷ mean volume of the PREVIOUS `period` bars (today excluded, so a spike
   * cannot inflate its own baseline). `null` until `period` prior bars exist, or when the prior
   * average is 0 (e.g. indices, which report no volume).
   */
  relativeVolume: IndicatorValue[];
  /** relativeVolume ≥ threshold; `null` where relativeVolume is null. */
  isSpike: (boolean | null)[];
}

export function analyzeVolume(volumes: readonly number[], period = 20, spikeThreshold = 2): VolumeAnalysis {
  assertPeriod(period, "Volume");
  if (!Number.isFinite(spikeThreshold) || spikeThreshold <= 0) {
    throw new RangeError(`Volume spike threshold must be a finite number > 0, got ${spikeThreshold}`);
  }
  assertFinite(volumes);
  const negative = volumes.findIndex((v) => v < 0);
  if (negative !== -1) throw new RangeError(`Volume at index ${negative} is negative (${volumes[negative]})`);

  const averageVolume = sma(volumes, period);
  const relativeVolume: IndicatorValue[] = new Array(volumes.length).fill(null);
  const isSpike: (boolean | null)[] = new Array(volumes.length).fill(null);
  for (let i = period; i < volumes.length; i++) {
    const prior = averageVolume[i - 1] as number; // mean of volumes[i−period … i−1]
    if (prior === 0) continue;
    const rv = volumes[i] / prior;
    relativeVolume[i] = rv;
    isSpike[i] = rv >= spikeThreshold;
  }
  return { averageVolume, relativeVolume, isSpike };
}

/** Volumes from bars (e.g. BarDTO[]), oldest → newest. */
export function volumes(bars: readonly { volume: number }[]): number[] {
  return bars.map((b) => b.volume);
}

/** Close prices from bars (e.g. BarDTO[]), oldest → newest. */
export function closes(bars: readonly CloseLike[]): number[] {
  return bars.map((b) => b.close);
}

/** Pairs indicator values with their bars' trading dates, e.g. for charting. */
export function toIndicatorSeries(bars: readonly { time: string }[], values: readonly IndicatorValue[]): IndicatorPoint[] {
  if (bars.length !== values.length) {
    throw new RangeError(`Length mismatch: ${bars.length} bars vs ${values.length} values`);
  }
  return bars.map((b, i) => ({ time: b.time, value: values[i] }));
}

/** Most recent non-null value, or null when the series never warmed up. */
export function latestValue(values: readonly IndicatorValue[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null) return v;
  }
  return null;
}
