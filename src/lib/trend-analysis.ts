/**
 * Trend analysis engine: rule-based, deterministic and explainable. Pure TypeScript.
 *
 * It DESCRIBES what past prices have done; it does not predict. Every assessment is built from
 * explicit signals that each vote +1 (bullish), 0 (neutral) or −1 (bearish), with a plain-language
 * reason. Confidence = share of the expected signals that agree (0–1), NOT a probability of any
 * future move. Missing signals (short history) lower confidence; disagreeing signals are reported
 * as conflicting instead of being averaged away.
 *
 * Built on the indicator functions in ./indicators (sma, ema, rsi, macd).
 */
import { ema, macd, rsi, sma, type IndicatorValue } from "./indicators";

// ───────────────────────────── Types ─────────────────────────────

export type TrendDirection = "bullish" | "bearish" | "sideways" | "insufficient_data";
export type Vote = -1 | 0 | 1;
export type ConfidenceLevel = "none" | "low" | "medium" | "high";

export interface Confidence {
  /** Share of expected signals that agree with the conclusion, 0–1. Not a forecast probability. */
  score: number;
  level: ConfidenceLevel;
}

export interface Signal {
  name: string;
  value: number | null;
  vote: Vote;
  explanation: string;
}

export interface TrendAssessment {
  horizon: "short" | "long";
  direction: TrendDirection;
  /** True when some signals point up and others down. */
  conflicting: boolean;
  confidence: Confidence;
  signals: Signal[];
  explanation: string;
  requiredBars: number;
  availableBars: number;
}

export type RsiZone = "overbought" | "bullish" | "neutral" | "bearish" | "oversold";

export interface MomentumAssessment {
  bias: Exclude<TrendDirection, "sideways"> | "neutral";
  conflicting: boolean;
  confidence: Confidence;
  rsi: number | null;
  rsiZone: RsiZone | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  /** Histogram vs previous bar: is the MACD-vs-signal gap widening in its direction? */
  histogramTrend: "strengthening" | "weakening" | "flat" | null;
  signals: Signal[];
  cautions: string[];
  explanation: string;
}

export interface PriceLevel {
  price: number;
  /** Number of swing highs/lows that formed near this price. */
  touches: number;
  strength: "weak" | "moderate" | "strong";
  lastTouched: string;
  /** Distance from the last close, in % (negative = below). */
  distancePercent: number;
}

export interface SupportResistance {
  support: PriceLevel[]; // nearest first
  resistance: PriceLevel[]; // nearest first
  rangeLow: number | null;
  rangeHigh: number | null;
  barsUsed: number;
  insufficientData: boolean;
  explanation: string;
}

export interface TrendAnalysis {
  asOf: string | null;
  lastClose: number | null;
  barsAnalyzed: number;
  shortTerm: TrendAssessment;
  longTerm: TrendAssessment;
  momentum: MomentumAssessment;
  levels: SupportResistance;
  /** Short- and long-term agreement. */
  alignment: "aligned" | "diverging" | "unclear";
  summary: string[];
  disclaimer: string;
}

export interface TrendBar {
  time: string;
  high: number;
  low: number;
  close: number;
}

export interface TrendOptions {
  /** Short term: price vs EMA(slow), EMA(fast) vs EMA(slow), EMA(slow) slope. */
  shortFast: number;
  shortSlow: number;
  shortSlopeBars: number;
  /** Long term: price vs SMA(slow), SMA(fast) vs SMA(slow), SMA(slow) slope. */
  longFast: number;
  longSlow: number;
  longSlopeBars: number;
  /** Bands (in %) inside which a comparison counts as neutral. */
  shortPriceBand: number;
  shortCrossBand: number;
  shortSlopeBand: number;
  longPriceBand: number;
  longCrossBand: number;
  longSlopeBand: number;
  /** RSI between these bounds is neutral momentum. */
  rsiNeutralLow: number;
  rsiNeutralHigh: number;
  /** |MACD histogram| below this % of price is treated as flat. */
  macdFlatBand: number;
  /**
   * If the last 14 closes span less than this % of price, momentum readings describe tiny swings
   * (RSI ignores move size), so momentum confidence is capped at "low".
   */
  minMomentumRange: number;
  /** Support/resistance: bars on each side for a swing point, lookback, and clustering tolerance (%). */
  pivotWindow: number;
  levelLookback: number;
  levelTolerance: number;
  maxLevels: number;
}

export const DEFAULT_TREND_OPTIONS: TrendOptions = {
  shortFast: 10,
  shortSlow: 20,
  shortSlopeBars: 5,
  longFast: 50,
  longSlow: 200,
  longSlopeBars: 20,
  shortPriceBand: 1,
  shortCrossBand: 0.25,
  shortSlopeBand: 0.5,
  longPriceBand: 2,
  longCrossBand: 1,
  longSlopeBand: 1,
  rsiNeutralLow: 45,
  rsiNeutralHigh: 55,
  macdFlatBand: 0.05,
  minMomentumRange: 1,
  pivotWindow: 5,
  levelLookback: 250,
  levelTolerance: 1.5,
  maxLevels: 3,
};

export const DISCLAIMER =
  "This describes how the price has behaved so far. It is not a prediction or investment advice; trends can reverse at any time.";

// ───────────────────────────── Shared helpers ─────────────────────────────

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score <= 0) return "none";
  if (score >= 0.99) return "high";
  if (score >= 0.66) return "medium";
  return "low";
}

export interface VoteClassification {
  direction: "bullish" | "bearish" | "sideways";
  conflicting: boolean;
  confidence: Confidence;
  lean: "bullish" | "bearish" | null;
}

/**
 * Turns signal votes into a direction.
 * - Any disagreement (some +1 and some −1) → sideways, conflicting, low confidence, with the lean noted.
 * - More bullish than neutral votes → bullish; more bearish than neutral → bearish.
 * - Otherwise → sideways (mostly neutral signals).
 * Confidence = agreeing votes ÷ `expected` (missing signals reduce it).
 */
export function classifyVotes(votes: readonly Vote[], expected = votes.length): VoteClassification {
  const total = Math.max(expected, votes.length, 1);
  const bull = votes.filter((v) => v === 1).length;
  const bear = votes.filter((v) => v === -1).length;
  const neutral = votes.length - bull - bear;
  const conf = (n: number): Confidence => {
    const score = Math.round((n / total) * 1000) / 1000;
    return { score, level: confidenceLevel(score) };
  };

  if (bull > 0 && bear > 0) {
    const score = Math.round((Math.abs(bull - bear) / total) * 0.5 * 1000) / 1000;
    return {
      direction: "sideways",
      conflicting: true,
      confidence: { score, level: score > 0 ? "low" : "none" },
      lean: bull > bear ? "bullish" : bear > bull ? "bearish" : null,
    };
  }
  if (bull > neutral) return { direction: "bullish", conflicting: false, confidence: conf(bull), lean: null };
  if (bear > neutral) return { direction: "bearish", conflicting: false, confidence: conf(bear), lean: null };
  return { direction: "sideways", conflicting: false, confidence: conf(neutral), lean: null };
}

const pct = (a: number, b: number) => ((a - b) / b) * 100;
const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const at = (series: IndicatorValue[], i: number) => (i >= 0 && i < series.length ? series[i] : null);

function voteBand(diffPercent: number, band: number): Vote {
  if (diffPercent > band) return 1;
  if (diffPercent < -band) return -1;
  return 0;
}

function assertBars(bars: readonly TrendBar[]): void {
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (![b.high, b.low, b.close].every(Number.isFinite)) {
      throw new RangeError(`Bar ${b.time} has a non-finite price`);
    }
    if (b.high < b.low) throw new RangeError(`Bar ${b.time} has high below low`);
    if (i > 0 && !(bars[i - 1].time < b.time)) {
      throw new RangeError(`Bars must be in strictly ascending time order (problem at ${b.time})`);
    }
  }
}

// ───────────────────────────── Trend (short / long) ─────────────────────────────

function insufficient(horizon: "short" | "long", required: number, available: number): TrendAssessment {
  return {
    horizon,
    direction: "insufficient_data",
    conflicting: false,
    confidence: { score: 0, level: "none" },
    signals: [],
    explanation: `Not enough history for a ${horizon}-term trend: needs ${required} daily bars, ${available} available.`,
    requiredBars: required,
    availableBars: available,
  };
}

function describeTrend(horizon: "short" | "long", c: VoteClassification, signals: Signal[]): string {
  const label = horizon === "short" ? "Short-term (about a month)" : "Long-term (about a year)";
  if (c.conflicting) {
    const lean = c.lean ? ` It leans ${c.lean}, but only weakly.` : "";
    return `${label}: signals disagree, so no clear trend.${lean} ${signals.map((s) => s.explanation).join(" ")}`;
  }
  const word =
    c.direction === "bullish" ? "uptrend (bullish)" : c.direction === "bearish" ? "downtrend (bearish)" : "sideways (no clear direction)";
  return `${label}: ${word}, ${c.confidence.level} confidence. ${signals.map((s) => s.explanation).join(" ")}`;
}

function assessTrend(
  horizon: "short" | "long",
  closes: number[],
  fastAvg: IndicatorValue[],
  slowAvg: IndicatorValue[],
  slopeBars: number,
  bands: { price: number; cross: number; slope: number },
  names: { fast: string; slow: string },
  required: number,
): TrendAssessment {
  const n = closes.length;
  if (n < required) return insufficient(horizon, required, n);
  const last = n - 1;
  const close = closes[last];
  const slow = slowAvg[last] as number;
  const fast = fastAvg[last] as number;
  const slowPast = slowAvg[last - slopeBars] as number;

  const priceDiff = pct(close, slow);
  const crossDiff = pct(fast, slow);
  const slopeDiff = pct(slow, slowPast);
  const priceVote = voteBand(priceDiff, bands.price);
  const crossVote = voteBand(crossDiff, bands.cross);
  const slopeVote = voteBand(slopeDiff, bands.slope);

  const signals: Signal[] = [
    {
      name: `Price vs ${names.slow}`,
      value: priceDiff,
      vote: priceVote,
      explanation:
        priceVote === 0
          ? `Price is close to its ${names.slow} (${fmt(priceDiff)}).`
          : `Price is ${priceVote > 0 ? "above" : "below"} its ${names.slow} (${fmt(priceDiff)}).`,
    },
    {
      name: `${names.fast} vs ${names.slow}`,
      value: crossDiff,
      vote: crossVote,
      explanation:
        crossVote === 0
          ? `The ${names.fast} and ${names.slow} are nearly equal (${fmt(crossDiff)}).`
          : `The faster ${names.fast} is ${crossVote > 0 ? "above" : "below"} the ${names.slow} (${fmt(crossDiff)}).`,
    },
    {
      name: `${names.slow} slope (${slopeBars} bars)`,
      value: slopeDiff,
      vote: slopeVote,
      explanation:
        slopeVote === 0
          ? `The ${names.slow} is roughly flat over ${slopeBars} sessions (${fmt(slopeDiff)}).`
          : `The ${names.slow} is ${slopeVote > 0 ? "rising" : "falling"} over ${slopeBars} sessions (${fmt(slopeDiff)}).`,
    },
  ];
  const c = classifyVotes(signals.map((s) => s.vote));
  return {
    horizon,
    direction: c.direction,
    conflicting: c.conflicting,
    confidence: c.confidence,
    signals,
    explanation: describeTrend(horizon, c, signals),
    requiredBars: required,
    availableBars: n,
  };
}

// ───────────────────────────── Momentum (RSI + MACD) ─────────────────────────────

export function rsiZone(value: number, neutralLow = 45, neutralHigh = 55): RsiZone {
  if (value >= 70) return "overbought";
  if (value <= 30) return "oversold";
  if (value > neutralHigh) return "bullish";
  if (value < neutralLow) return "bearish";
  return "neutral";
}

function assessMomentum(closes: number[], o: TrendOptions): MomentumAssessment {
  const n = closes.length;
  const last = n - 1;
  const rsiValue = n >= 15 ? at(rsi(closes, 14), last) : null;
  const m = n >= 26 ? macd(closes, 12, 26, 9) : null;
  const macdLine = m ? at(m.macd, last) : null;
  const signalLine = m ? at(m.signal, last) : null;
  const hist = m ? at(m.histogram, last) : null;
  const prevHist = m ? at(m.histogram, last - 1) : null;

  const signals: Signal[] = [];
  const cautions: string[] = [];
  let zone: RsiZone | null = null;

  if (rsiValue !== null) {
    zone = rsiZone(rsiValue, o.rsiNeutralLow, o.rsiNeutralHigh);
    const vote: Vote = rsiValue > o.rsiNeutralHigh ? 1 : rsiValue < o.rsiNeutralLow ? -1 : 0;
    signals.push({
      name: "RSI (14)",
      value: rsiValue,
      vote,
      explanation:
        vote === 0
          ? `RSI is ${rsiValue.toFixed(1)}, near the middle: gains and losses have been balanced.`
          : `RSI is ${rsiValue.toFixed(1)}: recent ${vote > 0 ? "gains have outweighed losses" : "losses have outweighed gains"}.`,
    });
    if (zone === "overbought") {
      cautions.push(
        `RSI ${rsiValue.toFixed(1)} is above 70 ("overbought"): the price has risen fast. That describes strength, not a signal to sell, but sharp moves often pause.`,
      );
    } else if (zone === "oversold") {
      cautions.push(
        `RSI ${rsiValue.toFixed(1)} is below 30 ("oversold"): the price has fallen fast. That is not by itself a signal to buy; falling prices can keep falling.`,
      );
    }
  }

  const flat = (v: number) => Math.abs(v) <= (closes[last] * o.macdFlatBand) / 100;
  if (macdLine !== null) {
    const vote: Vote = flat(macdLine) ? 0 : macdLine > 0 ? 1 : -1;
    signals.push({
      name: "MACD vs zero",
      value: macdLine,
      vote,
      explanation:
        vote === 0
          ? "MACD is near zero: the 12- and 26-day averages are close together."
          : `MACD is ${vote > 0 ? "above" : "below"} zero: the 12-day average is ${vote > 0 ? "above" : "below"} the 26-day average.`,
    });
  }
  if (hist !== null) {
    const vote: Vote = flat(hist) ? 0 : hist > 0 ? 1 : -1;
    signals.push({
      name: "MACD vs signal line",
      value: hist,
      vote,
      explanation:
        vote === 0
          ? "MACD is level with its signal line: momentum is not clearly changing."
          : `MACD is ${vote > 0 ? "above" : "below"} its signal line: short-term momentum is ${vote > 0 ? "improving" : "weakening"}.`,
    });
  }

  let histogramTrend: MomentumAssessment["histogramTrend"] = null;
  if (hist !== null && prevHist !== null) {
    if (flat(hist - prevHist)) histogramTrend = "flat";
    else histogramTrend = Math.abs(hist) > Math.abs(prevHist) && Math.sign(hist) === Math.sign(prevHist) ? "strengthening" : "weakening";
  }

  const expected = 3;
  if (signals.length === 0) {
    return {
      bias: "insufficient_data",
      conflicting: false,
      confidence: { score: 0, level: "none" },
      rsi: null,
      rsiZone: null,
      macd: null,
      histogramTrend: null,
      signals,
      cautions,
      explanation: `Not enough history for momentum: RSI needs 15 daily bars, ${n} available.`,
    };
  }
  if (signals.length < expected) {
    cautions.push(
      hist === null && macdLine === null
        ? `MACD needs at least 26 bars (34 for its signal line); only ${n} available, so momentum relies on RSI alone.`
        : `The MACD signal line needs 34 bars; only ${n} available.`,
    );
  }

  let c = classifyVotes(signals.map((s) => s.vote), expected);
  const recent = closes.slice(-14);
  const rangePercent = ((Math.max(...recent) - Math.min(...recent)) / closes[last]) * 100;
  if (rangePercent < o.minMomentumRange && c.confidence.score > 0) {
    const score = Math.min(c.confidence.score, 0.33);
    c = { ...c, confidence: { score, level: confidenceLevel(score) } };
    cautions.push(
      `Prices moved within only ${rangePercent.toFixed(2)}% over the last 14 sessions. RSI and MACD measure direction, not size, so these momentum readings exaggerate very small swings.`,
    );
  }
  const bias: MomentumAssessment["bias"] = c.direction === "sideways" ? "neutral" : c.direction;
  const head = c.conflicting
    ? `Momentum signals disagree${c.lean ? ` (leaning ${c.lean})` : ""}, so momentum is unclear.`
    : bias === "neutral"
      ? `Momentum is neutral (${c.confidence.level} confidence).`
      : `Momentum is ${bias} (${c.confidence.level} confidence).`;

  return {
    bias,
    conflicting: c.conflicting,
    confidence: c.confidence,
    rsi: rsiValue,
    rsiZone: zone,
    macd: macdLine !== null && signalLine !== null && hist !== null ? { macd: macdLine, signal: signalLine, histogram: hist } : null,
    histogramTrend,
    signals,
    cautions,
    explanation: `${head} ${signals.map((s) => s.explanation).join(" ")}`,
  };
}

// ───────────────────────────── Support / resistance ─────────────────────────────

interface Pivot {
  price: number;
  time: string;
}

/** Swing highs/lows: strictly beyond the `w` bars before, and at least as extreme as the `w` bars after. */
export function findPivots(bars: readonly TrendBar[], w: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = w; i < bars.length - w; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - w; j <= i + w && (isHigh || isLow); j++) {
      if (j === i) continue;
      if (j < i ? bars[j].high >= bars[i].high : bars[j].high > bars[i].high) isHigh = false;
      if (j < i ? bars[j].low <= bars[i].low : bars[j].low < bars[i].low) isLow = false;
    }
    if (isHigh) highs.push({ price: bars[i].high, time: bars[i].time });
    if (isLow) lows.push({ price: bars[i].low, time: bars[i].time });
  }
  return { highs, lows };
}

/** Groups nearby pivot prices (within `tolerance`% of the running cluster mean). */
export function clusterLevels(pivots: readonly Pivot[], tolerance: number): { price: number; touches: number; lastTouched: string }[] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: { sum: number; count: number; last: string }[] = [];
  for (const p of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(pct(p.price, c.sum / c.count)) <= tolerance) {
      c.sum += p.price;
      c.count++;
      if (p.time > c.last) c.last = p.time;
    } else {
      clusters.push({ sum: p.price, count: 1, last: p.time });
    }
  }
  return clusters.map((c) => ({ price: c.sum / c.count, touches: c.count, lastTouched: c.last }));
}

function findLevels(bars: readonly TrendBar[], o: TrendOptions): SupportResistance {
  const window = bars.slice(-o.levelLookback);
  const minBars = 2 * o.pivotWindow + 1;
  if (window.length < minBars) {
    return {
      support: [],
      resistance: [],
      rangeLow: null,
      rangeHigh: null,
      barsUsed: window.length,
      insufficientData: true,
      explanation: `Not enough history to find support or resistance: needs ${minBars} daily bars, ${window.length} available.`,
    };
  }
  const close = window[window.length - 1].close;
  const rangeLow = Math.min(...window.map((b) => b.low));
  const rangeHigh = Math.max(...window.map((b) => b.high));
  const { highs, lows } = findPivots(window, o.pivotWindow);
  // Old resistance can become support (and vice versa), so both kinds of pivot are candidates.
  const levels = clusterLevels([...highs, ...lows], o.levelTolerance).map<PriceLevel>((l) => ({
    price: l.price,
    touches: l.touches,
    strength: l.touches >= 3 ? "strong" : l.touches === 2 ? "moderate" : "weak",
    lastTouched: l.lastTouched,
    distancePercent: pct(l.price, close),
  }));
  const support = levels.filter((l) => l.price <= close).sort((a, b) => b.price - a.price).slice(0, o.maxLevels);
  const resistance = levels.filter((l) => l.price > close).sort((a, b) => a.price - b.price).slice(0, o.maxLevels);

  const parts = [
    `Based on ${highs.length + lows.length} swing highs/lows over the last ${window.length} sessions.`,
    support.length
      ? `Nearest support ≈ ${support[0].price.toFixed(2)} (${fmt(support[0].distancePercent)}, ${support[0].touches} touch${support[0].touches === 1 ? "" : "es"}).`
      : `No swing low below the current price in this window: price is near the bottom of its ${window.length}-session range (low ${rangeLow.toFixed(2)}).`,
    resistance.length
      ? `Nearest resistance ≈ ${resistance[0].price.toFixed(2)} (${fmt(resistance[0].distancePercent)}, ${resistance[0].touches} touch${resistance[0].touches === 1 ? "" : "es"}).`
      : `No swing high above the current price in this window: price is near the top of its ${window.length}-session range (high ${rangeHigh.toFixed(2)}).`,
    "Levels are zones where the price turned before; they can break.",
  ];
  return {
    support,
    resistance,
    rangeLow,
    rangeHigh,
    barsUsed: window.length,
    insufficientData: false,
    explanation: parts.join(" "),
  };
}

// ───────────────────────────── Entry point ─────────────────────────────

/** Analyses daily bars (oldest → newest), e.g. BarDTO[] from the price service. */
export function analyzeTrend(bars: readonly TrendBar[], options: Partial<TrendOptions> = {}): TrendAnalysis {
  const o = { ...DEFAULT_TREND_OPTIONS, ...options };
  assertBars(bars);
  const closes = bars.map((b) => b.close);
  const n = closes.length;

  const shortTerm = assessTrend(
    "short",
    closes,
    n >= o.shortFast ? ema(closes, o.shortFast) : [],
    n >= o.shortSlow ? ema(closes, o.shortSlow) : [],
    o.shortSlopeBars,
    { price: o.shortPriceBand, cross: o.shortCrossBand, slope: o.shortSlopeBand },
    { fast: `${o.shortFast}-day EMA`, slow: `${o.shortSlow}-day EMA` },
    o.shortSlow + o.shortSlopeBars,
  );
  const longTerm = assessTrend(
    "long",
    closes,
    n >= o.longFast ? sma(closes, o.longFast) : [],
    n >= o.longSlow ? sma(closes, o.longSlow) : [],
    o.longSlopeBars,
    { price: o.longPriceBand, cross: o.longCrossBand, slope: o.longSlopeBand },
    { fast: `${o.longFast}-day SMA`, slow: `${o.longSlow}-day SMA` },
    o.longSlow + o.longSlopeBars,
  );
  const momentum = assessMomentum(closes, o);
  const levels = findLevels(bars, o);

  const known = (d: TrendDirection) => d !== "insufficient_data";
  let alignment: TrendAnalysis["alignment"] = "unclear";
  if (known(shortTerm.direction) && known(longTerm.direction) && !shortTerm.conflicting && !longTerm.conflicting) {
    alignment = shortTerm.direction === longTerm.direction ? "aligned" : "diverging";
  }

  const summary = [shortTerm.explanation, longTerm.explanation, momentum.explanation, ...momentum.cautions, levels.explanation];
  if (alignment === "diverging") {
    summary.splice(
      2,
      0,
      `Short-term (${shortTerm.direction}) and long-term (${longTerm.direction}) trends point different ways. This often happens during pullbacks or early turns, and the outcome is uncertain.`,
    );
  }

  return {
    asOf: n ? bars[n - 1].time : null,
    lastClose: n ? closes[n - 1] : null,
    barsAnalyzed: n,
    shortTerm,
    longTerm,
    momentum,
    levels,
    alignment,
    summary,
    disclaimer: DISCLAIMER,
  };
}
