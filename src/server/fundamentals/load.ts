/**
 * Loads, validates and classifies fundamentals. NEVER throws: every outcome is an explicit status,
 * so a provider problem can only make fundamentals unavailable — it cannot affect price data,
 * technical analysis or risk analysis.
 */
import type { CompanyFundamentals, DataOrigin, FundamentalsInstrumentRef } from "@/lib/fundamentals/types";
import { validateFundamentals, type ValidationIssue } from "@/lib/fundamentals/validate";
import {
  assessCompleteness,
  assessFreshness,
  describeFundamentals,
  fundamentalsLabel,
  type CompletenessInfo,
  type FreshnessInfo,
} from "@/lib/fundamentals/status";
import { FundamentalsError, type FundamentalsErrorKind, type FundamentalsProvider } from "./provider";

export type FundamentalsResult =
  | {
      status: "ok";
      data: CompanyFundamentals;
      origin: DataOrigin;
      freshness: FreshnessInfo;
      completeness: CompletenessInfo;
      /** Badge text, e.g. "MOCK · current". */
      label: string;
      explanation: string;
      warnings: ValidationIssue[];
    }
  /** No provider configured. */
  | { status: "disabled"; reason: string }
  /** Fundamentals don't apply (e.g. indices). */
  | { status: "unsupported"; reason: string }
  /** Provider has nothing for this company. */
  | { status: "missing"; reason: string; provider: string }
  /** Provider returned data that failed validation; nothing is shown. */
  | { status: "invalid"; reason: string; provider: string; issues: ValidationIssue[] }
  | { status: "error"; code: FundamentalsErrorKind; reason: string; provider: string };

export const DEFAULT_FUNDAMENTALS_TIMEOUT_MS = 15_000;

export async function loadFundamentals(
  provider: FundamentalsProvider | null,
  ref: FundamentalsInstrumentRef,
  { now = new Date(), timeoutMs = DEFAULT_FUNDAMENTALS_TIMEOUT_MS }: { now?: Date; timeoutMs?: number } = {},
): Promise<FundamentalsResult> {
  if (!provider) return { status: "disabled", reason: "Fundamental data is turned off (set FUNDAMENTALS_PROVIDER to enable)." };
  if (ref.type !== "EQUITY") {
    return { status: "unsupported", reason: `${ref.symbol} is ${ref.type === "INDEX" ? "an index" : "a fund"}, which has no company financial statements.` };
  }
  if (!provider.supports(ref)) {
    return { status: "unsupported", reason: `${provider.name} does not cover ${ref.symbol} on ${ref.market}.` };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FundamentalsError("TIMEOUT", `No response within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });

  try {
    const raw = await Promise.race([Promise.resolve().then(() => provider.fetchFundamentals(ref, { signal: controller.signal })), timeout]);
    if (raw === null) {
      return { status: "missing", reason: `No financial statements available for ${ref.symbol} from ${provider.name}.`, provider: provider.name };
    }

    const v = validateFundamentals(raw, { expectedCurrency: ref.currency, now });
    if (!v.valid || !v.data) {
      const first = v.issues.find((i) => i.level === "error");
      return {
        status: "invalid",
        reason: `Financial data failed validation${first ? `: ${first.where}: ${first.message}` : ""}.`,
        provider: provider.name,
        issues: v.issues,
      };
    }
    if (v.data.symbol !== ref.symbol || v.data.market !== ref.market) {
      return { status: "invalid", reason: `Provider returned data for ${v.data.symbol} (${v.data.market}), not ${ref.symbol}.`, provider: provider.name, issues: [] };
    }
    // The provider's declared origin wins only in the safe direction: anything from a mock
    // provider is mock, even if the payload claims otherwise.
    const origin: DataOrigin = provider.origin === "mock" || v.data.provenance.origin === "mock" ? "mock" : "real";
    const data: CompanyFundamentals = { ...v.data, provenance: { ...v.data.provenance, origin } };
    const freshness = assessFreshness(data, now);
    const completeness = assessCompleteness(data);
    if (completeness.completeness === "empty") {
      return { status: "missing", reason: `${provider.name} returned no figures for ${ref.symbol}.`, provider: provider.name };
    }
    return {
      status: "ok",
      data,
      origin,
      freshness,
      completeness,
      label: fundamentalsLabel(origin, freshness.freshness),
      explanation: describeFundamentals(origin, freshness, completeness),
      warnings: v.issues.filter((i) => i.level === "warning"),
    };
  } catch (err) {
    if (err instanceof FundamentalsError) return { status: "error", code: err.kind, reason: err.message, provider: provider.name };
    return { status: "error", code: "PROVIDER_ERROR", reason: "The fundamentals provider failed unexpectedly.", provider: provider.name };
  } finally {
    clearTimeout(timer);
  }
}
