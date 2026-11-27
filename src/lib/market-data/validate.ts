/**
 * Validation for normalized daily bars before they are stored. Pure and unit-tested.
 *
 * Hard rejections (bar is not stored): non-finite or non-positive prices, inconsistent OHLC,
 * negative volume, malformed/weekend/future dates, duplicates within the batch.
 * Batch rejection: currency mismatch between provider and instrument.
 * Warnings (bar is stored): very large close-to-close moves, which can be real (crashes,
 * splits on unadjusted data) but deserve a look.
 */
import { isWeekend } from "../time";
import type { NormalizedDailyBar } from "./types";

export interface BarRejection {
  tradingDate: string;
  reasons: string[];
}

export interface ValidationResult {
  valid: NormalizedDailyBar[]; // sorted oldest → newest, unique by tradingDate
  rejected: BarRejection[];
  warnings: string[];
  /** Set when the whole batch must be discarded. */
  batchError: string | null;
}

export interface ValidationContext {
  expectedCurrency: string;
  providerCurrency: string;
  /** Latest exchange-local date whose session has completed; later bars are rejected. */
  lastCompletedDate: string;
  /** Indices legitimately report zero volume. */
  allowZeroVolume: boolean;
  /** Absolute close-to-close move (fraction) above which a warning is raised. Default 0.4 */
  jumpWarningThreshold?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateBar(bar: NormalizedDailyBar, ctx: ValidationContext): string[] {
  const reasons: string[] = [];
  if (!isRealDate(bar.tradingDate)) {
    reasons.push(`invalid trading date "${bar.tradingDate}"`);
  } else {
    if (isWeekend(bar.tradingDate)) reasons.push("trading date falls on a weekend");
    if (bar.tradingDate > ctx.lastCompletedDate) reasons.push("session has not completed yet");
  }
  const prices = { open: bar.open, high: bar.high, low: bar.low, close: bar.close };
  for (const [k, v] of Object.entries(prices)) {
    if (typeof v !== "number" || !Number.isFinite(v)) reasons.push(`${k} is not a finite number`);
    else if (v <= 0) reasons.push(`${k} must be positive`);
  }
  if (reasons.length === 0) {
    if (bar.high < bar.low) reasons.push("high is below low");
    if (bar.high < Math.max(bar.open, bar.close)) reasons.push("high is below open/close");
    if (bar.low > Math.min(bar.open, bar.close)) reasons.push("low is above open/close");
  }
  if (typeof bar.volume !== "number" || !Number.isFinite(bar.volume)) reasons.push("volume is not a finite number");
  else if (bar.volume < 0) reasons.push("volume is negative");
  else if (bar.volume === 0 && !ctx.allowZeroVolume) reasons.push("volume is zero for a traded instrument");
  return reasons;
}

export function validateDailyBars(bars: NormalizedDailyBar[], ctx: ValidationContext): ValidationResult {
  if (ctx.providerCurrency.toUpperCase() !== ctx.expectedCurrency.toUpperCase()) {
    return {
      valid: [],
      rejected: bars.map((b) => ({ tradingDate: b.tradingDate, reasons: ["currency mismatch"] })),
      warnings: [],
      batchError: `Currency mismatch: provider reports ${ctx.providerCurrency}, instrument is quoted in ${ctx.expectedCurrency}`,
    };
  }

  const sorted = [...bars].sort((a, b) => (a.tradingDate < b.tradingDate ? -1 : a.tradingDate > b.tradingDate ? 1 : 0));
  const valid: NormalizedDailyBar[] = [];
  const rejected: BarRejection[] = [];
  const seen = new Set<string>();

  for (const bar of sorted) {
    const reasons = validateBar(bar, ctx);
    if (seen.has(bar.tradingDate)) reasons.push("duplicate trading date in response");
    if (reasons.length) {
      rejected.push({ tradingDate: bar.tradingDate, reasons });
      continue;
    }
    seen.add(bar.tradingDate);
    valid.push(bar);
  }

  const warnings: string[] = [];
  const threshold = ctx.jumpWarningThreshold ?? 0.4;
  for (let i = 1; i < valid.length; i++) {
    const move = valid[i].close / valid[i - 1].close - 1;
    if (Math.abs(move) > threshold) {
      warnings.push(
        `${valid[i].tradingDate}: close moved ${(move * 100).toFixed(1)}% from ${valid[i - 1].tradingDate} (possible split or data error)`,
      );
    }
  }

  return { valid, rejected, warnings, batchError: null };
}
