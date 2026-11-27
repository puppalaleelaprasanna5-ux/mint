/**
 * Deterministic SIMULATED daily OHLCV generator.
 *
 * Model: correlated geometric Brownian motion. Each region has a common daily "market factor"
 * shock; each instrument mixes it with an idiosyncratic shock by `marketCorrelation`.
 * Output is for development and UI demonstration ONLY. It is not market data and carries
 * no predictive meaning.
 */
import { hashSeed, mulberry32, normalSampler } from "./prng";

export interface SimParams {
  startPrice: number;
  annualDrift: number;
  annualVol: number;
  marketCorrelation: number;
  baseVolume: number;
}

export interface SimBar {
  tradingDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const TRADING_DAYS_PER_YEAR = 252;

/** Common daily shocks for a region (one standard-normal draw per date). */
export function generateMarketFactor(dates: string[], seedKey: string): number[] {
  const normal = normalSampler(mulberry32(hashSeed(`factor:${seedKey}`)));
  return dates.map(() => normal());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function generateBars(
  dates: string[],
  factor: number[],
  params: SimParams,
  seedKey: string,
): SimBar[] {
  if (factor.length !== dates.length) {
    throw new Error("Market factor length must match number of dates");
  }
  const normal = normalSampler(mulberry32(hashSeed(`bars:${seedKey}`)));
  const sigmaD = params.annualVol / Math.sqrt(TRADING_DAYS_PER_YEAR);
  const muD = params.annualDrift / TRADING_DAYS_PER_YEAR - 0.5 * sigmaD * sigmaD;
  const rho = Math.min(Math.max(params.marketCorrelation, 0), 1);
  const idioWeight = Math.sqrt(1 - rho * rho);

  const bars: SimBar[] = [];
  let prevClose = params.startPrice;

  for (let i = 0; i < dates.length; i++) {
    const z = rho * factor[i] + idioWeight * normal();
    const logReturn = muD + sigmaD * z;

    // Split the day's move into an overnight gap and an intraday move.
    const gap = 0.25 * sigmaD * normal();
    const o = round2(prevClose * Math.exp(gap));
    const c = round2(prevClose * Math.exp(logReturn));
    const wickUp = Math.abs(normal()) * sigmaD * 0.45;
    const wickDown = Math.abs(normal()) * sigmaD * 0.45;
    const h = round2(Math.max(o, c) * (1 + wickUp));
    const l = round2(Math.min(o, c) * (1 - wickDown));

    let volume = 0;
    if (params.baseVolume > 0) {
      const surprise = Math.abs(logReturn - muD) / sigmaD; // bigger moves → more volume
      volume = Math.round(params.baseVolume * Math.exp(0.3 * normal()) * (0.8 + 0.25 * surprise));
    }

    bars.push({
      tradingDate: dates[i],
      open: o,
      high: Math.max(h, o, c),
      low: Math.min(l, o, c),
      close: c,
      volume,
    });
    prevClose = c;
  }
  return bars;
}
