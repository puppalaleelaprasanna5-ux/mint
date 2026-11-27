/**
 * Provider-independent market-data contracts. Adapters translate provider responses into
 * `NormalizedDailyBar`s; the sync service validates them and stores them as `PriceBar` rows.
 */

export type ProviderId = "upstox" | "alpaca";

/** One daily OHLCV bar keyed by the exchange-local trading date. */
export interface NormalizedDailyBar {
  tradingDate: string; // "YYYY-MM-DD" in the exchange's time zone
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProviderInstrumentRef {
  providerSymbol: string; // e.g. "NSE_EQ|INE002A01018" or "AAPL"
  symbol: string; // Mint symbol, for messages
  type: "EQUITY" | "INDEX" | "ETF";
  currency: string; // currency Mint expects for this instrument
}

export interface ProviderMarketRef {
  code: string;
  timezone: string;
  currency: string;
}

export interface DailyBarsRequest {
  instrument: ProviderInstrumentRef;
  market: ProviderMarketRef;
  fromDate: string; // inclusive, exchange-local
  toDate: string; // inclusive, exchange-local
  /** Never request bars newer than this instant (respects provider delay rules). */
  notAfter: Date;
}

export interface DailyBarsResult {
  /** PriceBar.source value for these bars, e.g. "upstox" or "alpaca-iex". */
  source: string;
  /** Currency the provider reports (or documents) for these prices. */
  currency: string;
  bars: NormalizedDailyBar[];
  /** Rows the adapter could not parse at all (malformed shape). */
  unparseable: number;
  notes: string[];
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  regions: ("IN" | "US")[];
  configured: boolean;
  /** Environment variable names that must be set (values are never exposed). */
  missingEnv: string[];
  source: string | null;
  notes: string[];
}

export interface MarketDataProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly regions: ("IN" | "US")[];
  status(): ProviderStatus;
  /** Whether the provider can serve this instrument type (e.g. Alpaca has no index data). */
  supports(instrument: ProviderInstrumentRef): boolean;
  fetchDailyBars(request: DailyBarsRequest): Promise<DailyBarsResult>;
}

export type ProviderErrorKind =
  | "NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "BAD_RESPONSE"
  | "NETWORK"
  | "SERVER_ERROR";

/** Errors carry no credentials; `message` is safe to store and show. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** Errors that make further requests to the same provider pointless in this run. */
  get stopsRun(): boolean {
    return this.kind === "NOT_CONFIGURED" || this.kind === "UNAUTHORIZED" || this.kind === "FORBIDDEN" || this.kind === "RATE_LIMITED";
  }
}

export const SOURCE_LABELS: Record<string, string> = {
  "mint-demo-generator": "Simulated",
  upstox: "Upstox",
  "alpaca-iex": "Alpaca · IEX",
  "alpaca-sip": "Alpaca · SIP",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
