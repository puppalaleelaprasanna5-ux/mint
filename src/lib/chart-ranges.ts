/**
 * Calendar-based chart ranges for the instrument page (pure, unit-tested).
 * Ranges count back from the LATEST stored bar, not from today, so a stale or
 * simulated series still shows a full window.
 */

export const DETAIL_RANGES = [
  { key: "1M", label: "1M", months: 1 },
  { key: "3M", label: "3M", months: 3 },
  { key: "6M", label: "6M", months: 6 },
  { key: "1Y", label: "1Y", months: 12 },
  { key: "5Y", label: "5Y", months: 60 },
] as const;

export type DetailRangeKey = (typeof DETAIL_RANGES)[number]["key"];

/** "YYYY-MM-DD" minus N calendar months, clamped to the target month's last day (Mar 31 − 1M = Feb 28). */
export function subtractMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) - months;
  const ty = Math.floor(totalMonths / 12);
  const tm = totalMonths % 12; // 0-based
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

export interface RangeSelection<T> {
  bars: T[];
  /** First date the range asks for. */
  requestedFrom: string | null;
  /** True when stored history starts after `requestedFrom` (the range is only partly covered). */
  partial: boolean;
}

/** Bars (ordered oldest → newest) within `months` of the last bar, inclusive. */
export function selectRange<T extends { time: string }>(bars: T[], key: DetailRangeKey): RangeSelection<T> {
  if (bars.length === 0) return { bars: [], requestedFrom: null, partial: false };
  const range = DETAIL_RANGES.find((r) => r.key === key) ?? DETAIL_RANGES[3];
  const last = bars[bars.length - 1].time;
  const from = subtractMonths(last, range.months);
  const selected = bars.filter((b) => b.time >= from);
  return { bars: selected, requestedFrom: from, partial: bars[0].time > from };
}

/** Human-readable span between two "YYYY-MM-DD" dates, e.g. "1 year 7 months", "3 weeks". */
export function describeSpan(from: string, to: string): string {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return "0 days";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.44);
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months} months`;
  return `${years} year${years === 1 ? "" : "s"}${rem ? ` ${rem} month${rem === 1 ? "" : "s"}` : ""}`;
}
