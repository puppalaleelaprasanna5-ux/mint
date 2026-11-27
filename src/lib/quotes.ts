/** Pure quote / series math shared by server services and client components. */

export interface CloseLike {
  close: number;
}

export interface QuoteChange {
  last: number;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
}

/** Change between the last two closes. `bars` must be ordered oldest → newest. */
export function computeChange(bars: CloseLike[]): QuoteChange | null {
  if (bars.length === 0) return null;
  const last = bars[bars.length - 1].close;
  if (bars.length < 2) return { last, previous: null, change: null, changePercent: null };
  const previous = bars[bars.length - 2].close;
  const change = last - previous;
  const changePercent = previous === 0 ? null : (change / previous) * 100;
  return { last, previous, change, changePercent };
}

/** Rebase a close series to percentage change from its first point (for comparing indices). */
export function toPercentFromStart<T extends { time: string; close: number }>(
  series: T[],
): { time: string; value: number }[] {
  if (series.length === 0) return [];
  const base = series[0].close;
  if (base === 0) return [];
  return series.map((p) => ({ time: p.time, value: ((p.close - base) / base) * 100 }));
}

export interface RangeStats {
  high: number;
  low: number;
  averageVolume: number | null;
}

/** High/low over the given bars and mean volume over the last `volumeWindow` bars. */
export function computeRangeStats(
  bars: { high: number; low: number; volume: number }[],
  volumeWindow = 20,
): RangeStats | null {
  if (bars.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  const recent = bars.slice(-volumeWindow).filter((b) => b.volume > 0);
  const averageVolume = recent.length
    ? recent.reduce((s, b) => s + b.volume, 0) / recent.length
    : null;
  return { high, low, averageVolume };
}

export type Trend = "up" | "down" | "flat";

export function trendOf(value: number | null | undefined): Trend {
  if (value == null || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}
