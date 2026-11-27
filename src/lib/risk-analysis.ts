/**
 * Risk analysis engine — pure, deterministic, descriptive. Measures how bumpy the PAST price
 * path was; it does not forecast future risk or returns.
 *
 * Definitions (daily bars, oldest → newest):
 * - Daily return r_t = close_t / close_{t−1} − 1 (between consecutive stored bars).
 * - Average daily return = arithmetic mean of r_t.
 * - Volatility = SAMPLE standard deviation (n − 1) of r_t, annualized × √252.
 * - Downside deviation = √( Σ min(r_t − target, 0)² / n ) over ALL returns (Sortino's definition,
 *   target 0 by default), annualized × √252.
 * - Maximum drawdown = largest fall from a running closing high, as a positive fraction.
 * - Beta = cov(r_asset, r_benchmark) / var(r_benchmark) on dates present in BOTH series; only
 *   reported when BOTH series are real (not simulated) and the overlap is long enough.
 *
 * Risk levels use common rule-of-thumb thresholds (documented below), not an official standard.
 */

export const TRADING_DAYS_PER_YEAR = 252;

export type MetricStatus = "ok" | "insufficient_data" | "unavailable";
export type RiskLevel = "low" | "moderate" | "high" | "very_high";

export interface Metric {
  /** Fractions, e.g. 0.25 = 25%. Null unless status is "ok". */
  value: number | null;
  status: MetricStatus;
  explanation: string;
}

export interface DrawdownMetric extends Metric {
  peakDate: string | null;
  troughDate: string | null;
  /** First date the close got back to the prior peak; null if it never did. */
  recoveredDate: string | null;
}

export interface BetaMetric extends Metric {
  benchmark: string | null;
  /** Number of daily returns both series share. */
  overlap: number;
}

export interface RiskAnalysis {
  asOf: string | null;
  barsAnalyzed: number;
  returnsAnalyzed: number;
  averageDailyReturn: Metric;
  /** Compounded change from the first to the last close. */
  totalReturn: Metric;
  volatility: Metric & { daily: number | null };
  downsideDeviation: Metric & { daily: number | null };
  maxDrawdown: DrawdownMetric;
  beta: BetaMetric;
  riskLevel: RiskLevel | "insufficient_data";
  riskExplanation: string;
  cautions: string[];
  disclaimer: string;
}

export interface RiskBar {
  time: string;
  close: number;
}

export interface BenchmarkInput {
  name: string;
  bars: readonly RiskBar[];
  /** Simulated benchmarks are never used for beta. */
  isSimulated: boolean;
}

export interface RiskOptions {
  /** Minimum daily returns for volatility / downside deviation. Default 20 (about a month). */
  minReturns: number;
  /** Minimum shared daily returns for beta. Default 60 (about three months). */
  minBetaOverlap: number;
  /** Target return per day for downside deviation. Default 0. */
  downsideTarget: number;
  /** Calendar days between bars above which a gap is reported. Default 7. */
  gapWarningDays: number;
  /** Whether the asset's own prices are simulated (adds a caution). */
  isSimulated: boolean;
  benchmark: BenchmarkInput | null;
}

export const DEFAULT_RISK_OPTIONS: RiskOptions = {
  minReturns: 20,
  minBetaOverlap: 60,
  downsideTarget: 0,
  gapWarningDays: 7,
  isSimulated: false,
  benchmark: null,
};

/** Annualized volatility thresholds (rule of thumb): < 15% low, < 30% moderate, < 50% high. */
export const VOLATILITY_LEVELS = { low: 0.15, moderate: 0.3, high: 0.5 };
/** Maximum drawdown thresholds (rule of thumb): < 10% low, < 20% moderate, < 35% high. */
export const DRAWDOWN_LEVELS = { low: 0.1, moderate: 0.2, high: 0.35 };

export const RISK_DISCLAIMER =
  "These numbers describe how much the price moved in the past. Future swings can be larger or smaller. This is not investment advice.";

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

// ───────────────────────────── Pure building blocks ─────────────────────────────

function assertBars(bars: readonly RiskBar[], label: string): void {
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!Number.isFinite(b.close) || b.close <= 0) {
      throw new RangeError(`${label}: close on ${b.time} must be a positive finite number (got ${b.close})`);
    }
    if (i > 0 && !(bars[i - 1].time < b.time)) {
      throw new RangeError(`${label}: bars must be in strictly ascending time order (problem at ${b.time})`);
    }
  }
}

/** Simple daily returns between consecutive closes. */
export function dailyReturns(closes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] / closes[i - 1] - 1);
  return out;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Sample standard deviation (n − 1). Null with fewer than 2 values. */
export function sampleStdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  const ss = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

/** Downside deviation over all returns (denominator n), relative to `target`. */
export function downsideDeviation(returns: readonly number[], target = 0): number | null {
  if (returns.length === 0) return null;
  const ss = returns.reduce((s, r) => s + Math.min(r - target, 0) ** 2, 0);
  return Math.sqrt(ss / returns.length);
}

export interface DrawdownResult {
  maxDrawdown: number; // positive fraction, 0 if never below a prior high
  peakIndex: number;
  troughIndex: number;
  recoveryIndex: number | null;
}

/** Largest peak-to-trough fall of the close series. Null with fewer than 2 closes. */
export function maxDrawdown(closes: readonly number[]): DrawdownResult | null {
  if (closes.length < 2) return null;
  let peakIndex = 0;
  let best: DrawdownResult = { maxDrawdown: 0, peakIndex: 0, troughIndex: 0, recoveryIndex: null };
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[peakIndex]) peakIndex = i;
    const dd = 1 - closes[i] / closes[peakIndex];
    if (dd > best.maxDrawdown) best = { maxDrawdown: dd, peakIndex, troughIndex: i, recoveryIndex: null };
  }
  if (best.maxDrawdown > 0) {
    const peak = closes[best.peakIndex];
    for (let i = best.troughIndex + 1; i < closes.length; i++) {
      if (closes[i] >= peak) {
        best.recoveryIndex = i;
        break;
      }
    }
  }
  return best;
}

/** Beta of `asset` vs `benchmark` returns (same length, already aligned). Null if var(benchmark) = 0. */
export function beta(asset: readonly number[], benchmark: readonly number[]): number | null {
  if (asset.length !== benchmark.length) throw new RangeError("Return series must have equal length");
  if (asset.length < 2) return null;
  const ma = mean(asset) as number;
  const mb = mean(benchmark) as number;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < asset.length; i++) {
    cov += (asset[i] - ma) * (benchmark[i] - mb);
    varB += (benchmark[i] - mb) ** 2;
  }
  if (varB === 0) return null;
  return cov / varB;
}

/**
 * Returns computed only between consecutive dates that exist in BOTH series, so a missing day
 * in either series never pairs returns from different periods.
 */
export function alignedReturns(
  asset: readonly RiskBar[],
  benchmark: readonly RiskBar[],
): { asset: number[]; benchmark: number[]; dates: string[] } {
  const bench = new Map(benchmark.map((b) => [b.time, b.close]));
  const common = asset.filter((b) => bench.has(b.time));
  const out = { asset: [] as number[], benchmark: [] as number[], dates: [] as string[] };
  for (let i = 1; i < common.length; i++) {
    out.asset.push(common[i].close / common[i - 1].close - 1);
    out.benchmark.push((bench.get(common[i].time) as number) / (bench.get(common[i - 1].time) as number) - 1);
    out.dates.push(common[i].time);
  }
  return out;
}

export function volatilityLevel(annualVol: number): RiskLevel {
  if (annualVol < VOLATILITY_LEVELS.low) return "low";
  if (annualVol < VOLATILITY_LEVELS.moderate) return "moderate";
  if (annualVol < VOLATILITY_LEVELS.high) return "high";
  return "very_high";
}

export function drawdownLevel(dd: number): RiskLevel {
  if (dd < DRAWDOWN_LEVELS.low) return "low";
  if (dd < DRAWDOWN_LEVELS.moderate) return "moderate";
  if (dd < DRAWDOWN_LEVELS.high) return "high";
  return "very_high";
}

const LEVEL_ORDER: RiskLevel[] = ["low", "moderate", "high", "very_high"];
const LEVEL_WORDS: Record<RiskLevel, string> = { low: "low", moderate: "moderate", high: "high", very_high: "very high" };

function calendarDays(a: string, b: string): number | null {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Number.isNaN(ta) || Number.isNaN(tb) ? null : Math.round((tb - ta) / 86_400_000);
}

// ───────────────────────────── Entry point ─────────────────────────────

export function analyzeRisk(bars: readonly RiskBar[], options: Partial<RiskOptions> = {}): RiskAnalysis {
  const o = { ...DEFAULT_RISK_OPTIONS, ...options };
  if (!Number.isInteger(o.minReturns) || o.minReturns < 2) throw new RangeError("minReturns must be an integer ≥ 2");
  if (!Number.isInteger(o.minBetaOverlap) || o.minBetaOverlap < 2) throw new RangeError("minBetaOverlap must be an integer ≥ 2");
  assertBars(bars, "Asset");

  const closes = bars.map((b) => b.close);
  const returns = dailyReturns(closes);
  const n = returns.length;
  const cautions: string[] = [];

  if (o.isSimulated) {
    cautions.push("These prices are SIMULATED, so every risk number here is for demonstration only.");
  }
  let gaps = 0;
  for (let i = 1; i < bars.length; i++) {
    const d = calendarDays(bars[i - 1].time, bars[i].time);
    if (d !== null && d > o.gapWarningDays) gaps++;
  }
  if (gaps > 0) {
    cautions.push(
      `${gaps} gap${gaps === 1 ? "" : "s"} longer than ${o.gapWarningDays} days in the price history: returns across a gap cover several days, which can overstate daily swings.`,
    );
  }
  if (n > 0 && n < TRADING_DAYS_PER_YEAR) {
    cautions.push(`Based on ${n} daily returns (less than a year), so these numbers may not reflect a full market cycle.`);
  }

  const notEnough = (what: string, need: number, unit = "daily returns") =>
    `Not enough history for ${what}: needs ${need} ${unit}, ${n} available.`;

  // Average daily return & total return
  const avg = mean(returns);
  const averageDailyReturn: Metric =
    avg === null
      ? { value: null, status: "insufficient_data", explanation: notEnough("an average daily return", 1) }
      : {
          value: avg,
          status: "ok",
          explanation: `On an average day the price changed by ${pct(avg, 3)} (simple average of ${n} daily returns).`,
        };
  const totalReturn: Metric =
    closes.length < 2
      ? { value: null, status: "insufficient_data", explanation: "Needs at least 2 closing prices." }
      : (() => {
          const t = closes[closes.length - 1] / closes[0] - 1;
          return {
            value: t,
            status: "ok" as const,
            explanation: `From ${bars[0].time} to ${bars[bars.length - 1].time} the price ${t >= 0 ? "rose" : "fell"} ${pct(Math.abs(t))} in total.`,
          };
        })();

  // Volatility
  const sd = n >= o.minReturns ? sampleStdDev(returns) : null;
  const volatility: RiskAnalysis["volatility"] =
    sd === null
      ? { value: null, daily: null, status: "insufficient_data", explanation: notEnough("volatility", o.minReturns) }
      : sd === 0
        ? {
            value: 0,
            daily: 0,
            status: "ok",
            explanation: "Volatility is 0%: the price did not change at all over this period, so there were no swings to measure.",
          }
        : (() => {
            const annual = sd * Math.sqrt(TRADING_DAYS_PER_YEAR);
            return {
              value: annual,
              daily: sd,
              status: "ok" as const,
              explanation: `Annualized volatility is ${pct(annual)} (${LEVEL_WORDS[volatilityLevel(annual)]}). Daily moves typically varied by about ±${pct(sd, 2)}; a higher number means a bumpier ride.`,
            };
          })();

  // Downside deviation
  const dd = n >= o.minReturns ? downsideDeviation(returns, o.downsideTarget) : null;
  const downside: RiskAnalysis["downsideDeviation"] =
    dd === null
      ? { value: null, daily: null, status: "insufficient_data", explanation: notEnough("downside deviation", o.minReturns) }
      : dd === 0
        ? {
            value: 0,
            daily: 0,
            status: "ok",
            explanation: "Downside deviation is 0%: there were no down days in this period.",
          }
        : (() => {
            const annual = dd * Math.sqrt(TRADING_DAYS_PER_YEAR);
            return {
              value: annual,
              daily: dd,
              status: "ok" as const,
              explanation: `Downside deviation is ${pct(annual)} annualized. It counts only the falling days, so it measures how harsh the drops were${
                volatility.value ? ` (compare: total volatility ${pct(volatility.value)})` : ""
              }.`,
            };
          })();

  // Maximum drawdown
  const draw = maxDrawdown(closes);
  const maxDd: DrawdownMetric =
    draw === null
      ? {
          value: null,
          status: "insufficient_data",
          explanation: "Needs at least 2 closing prices.",
          peakDate: null,
          troughDate: null,
          recoveredDate: null,
        }
      : draw.maxDrawdown === 0
        ? {
            value: 0,
            status: "ok",
            explanation: "No drawdown: the price never closed below an earlier high in this period.",
            peakDate: null,
            troughDate: null,
            recoveredDate: null,
          }
        : {
            value: draw.maxDrawdown,
            status: "ok",
            explanation: `The worst fall was ${pct(draw.maxDrawdown)}, from a high on ${bars[draw.peakIndex].time} to a low on ${bars[draw.troughIndex].time}. ${
              draw.recoveryIndex !== null
                ? `It got back to that high on ${bars[draw.recoveryIndex].time}.`
                : "It has not yet recovered to that high."
            }`,
            peakDate: bars[draw.peakIndex].time,
            troughDate: bars[draw.troughIndex].time,
            recoveredDate: draw.recoveryIndex !== null ? bars[draw.recoveryIndex].time : null,
          };

  // Beta (only with a reliable benchmark)
  let betaMetric: BetaMetric;
  const bm = o.benchmark;
  if (!bm) {
    betaMetric = { value: null, status: "unavailable", benchmark: null, overlap: 0, explanation: "Beta unavailable: no benchmark series was provided." };
  } else if (o.isSimulated) {
    betaMetric = {
      value: null,
      status: "unavailable",
      benchmark: bm.name,
      overlap: 0,
      explanation: `Beta unavailable: this instrument's prices are simulated, so comparing them with ${bm.name} would be meaningless.`,
    };
  } else if (bm.isSimulated) {
    betaMetric = {
      value: null,
      status: "unavailable",
      benchmark: bm.name,
      overlap: 0,
      explanation: `Beta unavailable: the ${bm.name} benchmark data is simulated, so comparing against it would be meaningless.`,
    };
  } else {
    assertBars(bm.bars, `Benchmark ${bm.name}`);
    const aligned = alignedReturns(bars, bm.bars);
    const overlap = aligned.asset.length;
    const b = overlap >= o.minBetaOverlap ? beta(aligned.asset, aligned.benchmark) : null;
    if (overlap < o.minBetaOverlap) {
      betaMetric = {
        value: null,
        status: "insufficient_data",
        benchmark: bm.name,
        overlap,
        explanation: `Beta unavailable: needs ${o.minBetaOverlap} daily returns on dates shared with ${bm.name}, only ${overlap} available.`,
      };
    } else if (b === null) {
      betaMetric = {
        value: null,
        status: "unavailable",
        benchmark: bm.name,
        overlap,
        explanation: `Beta unavailable: ${bm.name} did not move over the shared dates, so there is nothing to compare against.`,
      };
    } else {
      const words =
        b > 1.1
          ? `tended to move more than ${bm.name} (about ${b.toFixed(2)}× its daily moves)`
          : b >= 0.9
            ? `tended to move roughly in line with ${bm.name}`
            : b > 0
              ? `tended to move less than ${bm.name} (about ${b.toFixed(2)}× its daily moves)`
              : `tended to move opposite to, or independently of, ${bm.name}`;
      betaMetric = {
        value: b,
        status: "ok",
        benchmark: bm.name,
        overlap,
        explanation: `Beta ${b.toFixed(2)} over ${overlap} shared days: the price ${words}.`,
      };
    }
  }

  // Overall level: the worse of volatility and drawdown (conservative).
  let riskLevel: RiskAnalysis["riskLevel"] = "insufficient_data";
  let riskExplanation = `Not enough history for a risk level: needs ${o.minReturns} daily returns, ${n} available.`;
  if (volatility.value !== null && maxDd.value !== null) {
    const v = volatilityLevel(volatility.value);
    const d = drawdownLevel(maxDd.value);
    riskLevel = LEVEL_ORDER[Math.max(LEVEL_ORDER.indexOf(v), LEVEL_ORDER.indexOf(d))];
    riskExplanation =
      volatility.value === 0
        ? "Risk level: low. The price did not move in this period, which is unusual for a traded instrument; check the data."
        : `Risk level: ${LEVEL_WORDS[riskLevel]}. Volatility ${pct(volatility.value)} is ${LEVEL_WORDS[v]} and the worst fall of ${pct(
            maxDd.value,
          )} is ${LEVEL_WORDS[d]}; the overall level uses whichever is higher.`;
  }

  return {
    asOf: bars.length ? bars[bars.length - 1].time : null,
    barsAnalyzed: bars.length,
    returnsAnalyzed: n,
    averageDailyReturn,
    totalReturn,
    volatility,
    downsideDeviation: downside,
    maxDrawdown: maxDd,
    beta: betaMetric,
    riskLevel,
    riskExplanation,
    cautions,
    disclaimer: RISK_DISCLAIMER,
  };
}
