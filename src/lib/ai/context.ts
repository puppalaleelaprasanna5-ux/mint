/**
 * Builds the compact, factual input an AI provider receives. Only numbers and labels Mint has
 * already computed are passed: no raw price history, no user data, no credentials.
 */
import type { TechnicalSummary } from "../technical-summary";

export interface ExplanationInstrument {
  symbol: string;
  name: string;
  type: string;
  market: string;
  currency: string;
}

export interface StockExplanationContext {
  instrument: ExplanationInstrument;
  data: { isSimulated: boolean; asOf: string | null; barsAnalyzed: number };
  trend: {
    shortTerm: { direction: string; confidence: string; conflicting: boolean };
    longTerm: { direction: string; confidence: string; conflicting: boolean };
    alignment: string;
  } | null;
  momentum: { bias: string; rsi: number | null; rsiZone: string | null; histogramTrend: string | null; cautions: string[] } | null;
  risk: {
    level: string;
    volatilityPct: number | null;
    maxDrawdownPct: number | null;
    downsideDeviationPct: number | null;
    beta: number | null;
    betaNote: string;
  } | null;
  levels: { close: number; nearestSupport: number | null; nearestResistance: number | null } | null;
  /** True when Mint has enough data for an explanation to say anything useful. */
  hasAnalysis: boolean;
}

const round = (v: number | null | undefined, digits = 2) => (v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const pct = (v: number | null | undefined) => (v == null ? null : round(v * 100, 1));

export function buildExplanationContext(instrument: ExplanationInstrument, summary: TechnicalSummary): StockExplanationContext {
  const t = summary.trend;
  const r = summary.risk;
  const s = summary.snapshot;
  return {
    instrument,
    data: { isSimulated: summary.isSimulated, asOf: summary.asOf, barsAnalyzed: summary.barsAnalyzed },
    trend: t
      ? {
          shortTerm: { direction: t.shortTerm.direction, confidence: t.shortTerm.confidence.level, conflicting: t.shortTerm.conflicting },
          longTerm: { direction: t.longTerm.direction, confidence: t.longTerm.confidence.level, conflicting: t.longTerm.conflicting },
          alignment: t.alignment,
        }
      : null,
    momentum: t
      ? {
          bias: t.momentum.bias,
          rsi: round(t.momentum.rsi, 1),
          rsiZone: t.momentum.rsiZone,
          histogramTrend: t.momentum.histogramTrend,
          cautions: t.momentum.cautions,
        }
      : null,
    risk: r
      ? {
          level: r.riskLevel,
          volatilityPct: pct(r.volatility.value),
          maxDrawdownPct: pct(r.maxDrawdown.value),
          downsideDeviationPct: pct(r.downsideDeviation.value),
          beta: round(r.beta.value),
          betaNote: r.beta.explanation,
        }
      : null,
    levels:
      s && t
        ? {
            close: round(s.close) as number,
            nearestSupport: round(t.levels.support[0]?.price),
            nearestResistance: round(t.levels.resistance[0]?.price),
          }
        : null,
    hasAnalysis: Boolean(s && t && r) && !summary.error,
  };
}
