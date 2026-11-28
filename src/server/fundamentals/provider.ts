/**
 * Provider-independent contract for fundamental (financial statement) data.
 * Like market-data providers, adapters may run in Next.js and in CLI scripts, and must read
 * credentials only from server-side env (none exist yet: 5A has no real provider).
 */
import type { CompanyFundamentals, DataOrigin, FundamentalsInstrumentRef } from "@/lib/fundamentals/types";

export type FundamentalsErrorKind = "NOT_CONFIGURED" | "FORBIDDEN" | "RATE_LIMITED" | "TIMEOUT" | "INVALID_RESPONSE" | "PROVIDER_ERROR";

/** Errors carry no secrets; `message` is safe to log and show. */
export class FundamentalsError extends Error {
  constructor(
    public readonly kind: FundamentalsErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "FundamentalsError";
  }
}

export interface FundamentalsProviderStatus {
  id: string;
  name: string;
  /** null when no provider is configured (there is no data, so no origin). */
  origin: DataOrigin | null;
  configured: boolean;
  missingEnv: string[];
  notes: string[];
}

/** Explicit "no data", with a reason the user can understand (e.g. "reports under IFRS"). */
export interface FundamentalsMissing {
  missing: true;
  reason: string;
}

export interface FundamentalsProvider {
  readonly id: string;
  readonly name: string;
  readonly origin: DataOrigin;
  status(): FundamentalsProviderStatus;
  /** Whether this provider can have statements for the instrument (indices never do). */
  supports(ref: FundamentalsInstrumentRef): boolean;
  /**
   * Raw provider output, normalised to CompanyFundamentals but NOT yet trusted: the loader
   * validates it. Resolve to null when the provider has no data for this company.
   */
  fetchFundamentals(ref: FundamentalsInstrumentRef, options: { signal: AbortSignal }): Promise<CompanyFundamentals | FundamentalsMissing | null>;
}
