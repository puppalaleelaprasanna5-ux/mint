/**
 * Classifies fundamentals along three independent axes so the UI and any AI layer can never
 * blur them together:
 * - origin:       real | mock                       (where the figures came from)
 * - freshness:    current | stale | unknown         (how recent the latest reported period is)
 * - completeness: complete | partial | empty        (how many expected figures are present)
 * "Missing" (no data at all) is a separate load status, see server/fundamentals/load.ts.
 */
import { BALANCE_FIELDS, CASH_FLOW_FIELDS, INCOME_FIELDS, type CompanyFundamentals, type DataOrigin, type FinancialStatementSet, type PeriodType } from "./types";

export type Freshness = "current" | "stale" | "unknown";
export type Completeness = "complete" | "partial" | "empty";

/**
 * A period counts as stale once this many days have passed since it ended. Rule of thumb:
 * period length plus a generous filing allowance (listed companies in India and the US normally
 * publish quarterly results within ~45–60 days and annual results within ~60–90 days).
 */
export const STALE_AFTER_DAYS: Record<PeriodType, number> = { quarterly: 91 + 75, annual: 365 + 120 };

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: Date) => Math.floor((to.getTime() - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export interface FreshnessInfo {
  freshness: Freshness;
  latestPeriodEnd: string | null;
  latestPeriodType: PeriodType | null;
  ageDays: number | null;
}

/**
 * Freshness of the newest reported period (annual or quarterly), judged against that period
 * type's threshold. On a tie, the quarterly threshold (stricter) applies.
 */
export function assessFreshness(data: CompanyFundamentals, now: Date = new Date()): FreshnessInfo {
  let newest: FinancialStatementSet["period"] | null = null;
  for (const s of [...data.quarterly, ...data.annual]) {
    if (!newest || s.period.periodEnd > newest.periodEnd) newest = s.period;
  }
  if (!newest) return { freshness: "unknown", latestPeriodEnd: null, latestPeriodType: null, ageDays: null };
  const age = daysBetween(newest.periodEnd, now);
  return {
    freshness: age > STALE_AFTER_DAYS[newest.type] ? "stale" : "current",
    latestPeriodEnd: newest.periodEnd,
    latestPeriodType: newest.type,
    ageDays: age,
  };
}

export interface CompletenessInfo {
  completeness: Completeness;
  /** Present figures ÷ expected figures across all periods and statements, 0–1. */
  ratio: number;
  present: number;
  expected: number;
}

export function assessCompleteness(data: CompanyFundamentals): CompletenessInfo {
  let present = 0;
  let expected = 0;
  for (const s of [...data.annual, ...data.quarterly]) {
    const groups: [Record<string, number | null> | null, readonly string[]][] = [
      [s.income as Record<string, number | null> | null, INCOME_FIELDS],
      [s.balance as Record<string, number | null> | null, BALANCE_FIELDS],
      [s.cashFlow as Record<string, number | null> | null, CASH_FLOW_FIELDS],
    ];
    for (const [stmt, fields] of groups) {
      expected += fields.length;
      if (stmt) for (const f of fields) if (stmt[f] !== null) present++;
    }
  }
  const ratio = expected ? Math.round((present / expected) * 1000) / 1000 : 0;
  return { completeness: present === 0 ? "empty" : present === expected ? "complete" : "partial", ratio, present, expected };
}

/** Short badge text, e.g. "MOCK · stale". */
export function fundamentalsLabel(origin: DataOrigin, freshness: Freshness): string {
  return `${origin === "mock" ? "MOCK" : "REAL"} · ${freshness}`;
}

export function describeFundamentals(origin: DataOrigin, f: FreshnessInfo, c: CompletenessInfo): string {
  const parts = [
    origin === "mock"
      ? "These financial figures are MOCK data generated for development. They are not the company's real results."
      : "Financial figures as reported by the data provider.",
  ];
  if (f.freshness === "stale") {
    parts.push(`The latest reported period ended ${f.latestPeriodEnd} (${f.ageDays} days ago), so newer results are probably missing.`);
  } else if (f.freshness === "unknown") {
    parts.push("No reporting periods are available.");
  } else {
    parts.push(`Latest reported period ended ${f.latestPeriodEnd}.`);
  }
  if (c.completeness === "partial") parts.push(`Some figures were not reported (${Math.round(c.ratio * 100)}% of expected figures present).`);
  return parts.join(" ");
}
