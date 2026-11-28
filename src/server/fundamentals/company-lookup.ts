/**
 * Provider-independent company lookup: identity + periodic-filing metadata for a listed company.
 * `lookupCompany` NEVER throws, so lookup problems cannot affect any other part of Mint.
 */
import type { CompanyFilings, CompanyIdentity } from "@/lib/fundamentals/company";
import type { FundamentalsInstrumentRef } from "@/lib/fundamentals/types";
import { FundamentalsError, type FundamentalsErrorKind } from "./provider";

export interface CompanyLookupStatus {
  id: string;
  name: string;
  configured: boolean;
  /** Environment variable NAMES that are missing (never values). */
  missingEnv: string[];
  notes: string[];
}

export interface CompanyMatch {
  identity: CompanyIdentity;
  filings: CompanyFilings;
  /** Exchange the source lists for this exact ticker (e.g. "Nasdaq"), or null if it lists none. */
  listedExchange: string | null;
  /** Whether that exchange is the Mint market the instrument belongs to. */
  exchangeMatches: boolean;
}

export interface CompanyLookupProvider {
  readonly id: string;
  readonly name: string;
  status(): CompanyLookupStatus;
  supports(ref: FundamentalsInstrumentRef): boolean;
  /** Resolves to null when the source has no company for this ticker. */
  lookup(ref: FundamentalsInstrumentRef, options: { signal?: AbortSignal }): Promise<CompanyMatch | null>;
}

export type CompanyLookupResult =
  | ({ status: "ok"; provider: string } & CompanyMatch)
  | { status: "disabled"; reason: string }
  | { status: "unsupported"; reason: string }
  | { status: "not_found"; reason: string; provider: string }
  | { status: "error"; code: FundamentalsErrorKind; reason: string; provider: string };

export async function lookupCompany(
  provider: CompanyLookupProvider | null,
  ref: FundamentalsInstrumentRef,
  options: { signal?: AbortSignal; disabledReason?: string } = {},
): Promise<CompanyLookupResult> {
  if (!provider) return { status: "disabled", reason: options.disabledReason ?? "Company lookup is turned off." };
  if (ref.type !== "EQUITY") {
    return { status: "unsupported", reason: `${ref.symbol} is ${ref.type === "INDEX" ? "an index" : "a fund"}, not a company.` };
  }
  if (!provider.supports(ref)) return { status: "unsupported", reason: `${provider.name} does not cover ${ref.market} listings.` };
  try {
    const match = await provider.lookup(ref, { signal: options.signal });
    if (!match) return { status: "not_found", reason: `${provider.name} has no company for ticker ${ref.symbol}.`, provider: provider.name };
    return { status: "ok", provider: provider.name, ...match };
  } catch (err) {
    if (err instanceof FundamentalsError) return { status: "error", code: err.kind, reason: err.message, provider: provider.name };
    return { status: "error", code: "PROVIDER_ERROR", reason: "Company lookup failed unexpectedly.", provider: provider.name };
  }
}
