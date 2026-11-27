/**
 * Upstox adapter — Indian markets (NSE/BSE), daily historical candles.
 *
 * API: GET https://api.upstox.com/v3/historical-candle/{instrument_key}/days/1/{to_date}/{from_date}
 * Docs: https://upstox.com/developer/api-documentation/v3/get-historical-candle-data
 *   - candle = [timestamp, open, high, low, close, volume, open_interest]
 *   - daily data available from Jan 2000, max one decade per request
 *   - current-day data is served by a separate intraday API, so only completed sessions are requested
 * Auth: Bearer access token. The free, read-only, 1-year "Analytics Token" covers the Historical
 * Data APIs (https://upstox.com/developer/api-documentation/analytics-token/). Mint always sends the
 * token and refuses to call the API without one, even if an unauthenticated call happens to work.
 *
 * Observed (not documented): candles are returned newest-first; daily timestamps are 00:00 IST.
 * The adapter sorts and derives the trading date in the exchange time zone, so neither matters.
 */
import { addDays, toZonedDateString } from "@/lib/time";
import {
  ProviderError,
  type DailyBarsRequest,
  type DailyBarsResult,
  type MarketDataProvider,
  type NormalizedDailyBar,
  type ProviderInstrumentRef,
  type ProviderStatus,
} from "@/lib/market-data/types";
import { clip, getJson, isRecord, type FetchLike } from "../http";

export const UPSTOX_SOURCE = "upstox";
const MAX_DAYS_PER_REQUEST = 3650; // "1 decade" per request for unit=days

export interface UpstoxConfig {
  accessToken?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

/** Upstox error bodies look like {status:"error", errors:[{errorCode, message}]}. */
function describeUpstoxError(status: number, body: unknown): string {
  const first = isRecord(body) && Array.isArray(body.errors) && isRecord(body.errors[0]) ? body.errors[0] : null;
  const detail = first ? `${clip(first.errorCode, 40)}: ${clip(first.message)}` : `HTTP ${status}`;
  if (status === 401) return `Upstox rejected the access token (${detail}). Generate a new token and update UPSTOX_ACCESS_TOKEN.`;
  if (status === 403) return `Upstox denied access (${detail}). Check that your token/app is permitted to use historical data.`;
  if (status === 429) return `Upstox rate limit reached (${detail}). Try again later.`;
  return `Upstox request failed (${detail})`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export class UpstoxProvider implements MarketDataProvider {
  readonly id = "upstox" as const;
  readonly name = "Upstox";
  readonly regions: ("IN" | "US")[] = ["IN"];
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: UpstoxConfig = {}) {
    this.token = config.accessToken?.trim() || undefined;
    this.baseUrl = (config.baseUrl ?? "https://api.upstox.com").replace(/\/$/, "");
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  }

  status(): ProviderStatus {
    return {
      id: this.id,
      name: this.name,
      regions: this.regions,
      configured: Boolean(this.token),
      missingEnv: this.token ? [] : ["UPSTOX_ACCESS_TOKEN"],
      source: UPSTOX_SOURCE,
      notes: [
        "Daily candles for NSE/BSE stocks and indices (NIFTY 50, SENSEX).",
        "Use the free read-only Analytics Token (valid 1 year) or a daily OAuth access token.",
        "Upstox does not document whether daily candles are adjusted for splits or bonuses.",
      ],
    };
  }

  supports(instrument: ProviderInstrumentRef): boolean {
    return /^(NSE|BSE)_(EQ|INDEX)\|/.test(instrument.providerSymbol);
  }

  async fetchDailyBars(req: DailyBarsRequest): Promise<DailyBarsResult> {
    if (!this.token) {
      throw new ProviderError(this.id, "NOT_CONFIGURED", "UPSTOX_ACCESS_TOKEN is not set");
    }
    if (!this.supports(req.instrument)) {
      throw new ProviderError(this.id, "INVALID_REQUEST", `Unsupported Upstox instrument key for ${req.instrument.symbol}`);
    }
    if (req.fromDate > req.toDate) {
      throw new ProviderError(this.id, "INVALID_REQUEST", "fromDate is after toDate");
    }

    // Split long ranges into ≤ 1-decade windows (Upstox's documented per-request limit).
    const windows: [string, string][] = [];
    for (let start = req.fromDate; start <= req.toDate; ) {
      const endCandidate = addDays(start, MAX_DAYS_PER_REQUEST - 1);
      const end = endCandidate < req.toDate ? endCandidate : req.toDate;
      windows.push([start, end]);
      start = addDays(end, 1);
    }

    const bars: NormalizedDailyBar[] = [];
    let unparseable = 0;
    for (const [from, to] of windows) {
      if (daysBetween(from, to) >= MAX_DAYS_PER_REQUEST) {
        throw new ProviderError(this.id, "INVALID_REQUEST", "Date window exceeds Upstox limit");
      }
      const key = encodeURIComponent(req.instrument.providerSymbol);
      const url = `${this.baseUrl}/v3/historical-candle/${key}/days/1/${to}/${from}`;
      const body = await getJson(
        this.id,
        this.fetchImpl,
        url,
        { Accept: "application/json", Authorization: `Bearer ${this.token}` },
        describeUpstoxError,
      );
      const parsed = this.parse(body, req.market.timezone);
      bars.push(...parsed.bars);
      unparseable += parsed.unparseable;
    }

    return {
      source: UPSTOX_SOURCE,
      // NSE/BSE cash and index segments are quoted in Indian rupees.
      currency: "INR",
      bars,
      unparseable,
      notes: [],
    };
  }

  /** Exposed for unit tests. */
  parse(body: unknown, timezone: string): { bars: NormalizedDailyBar[]; unparseable: number } {
    if (!isRecord(body) || body.status !== "success" || !isRecord(body.data) || !Array.isArray(body.data.candles)) {
      throw new ProviderError(this.id, "BAD_RESPONSE", "Unexpected Upstox response shape (expected data.candles)");
    }
    const bars: NormalizedDailyBar[] = [];
    let unparseable = 0;
    for (const row of body.data.candles as unknown[]) {
      if (!Array.isArray(row) || row.length < 6 || typeof row[0] !== "string") {
        unparseable++;
        continue;
      }
      const instant = new Date(row[0]);
      if (Number.isNaN(instant.getTime())) {
        unparseable++;
        continue;
      }
      const [open, high, low, close, volume] = row.slice(1, 6).map((v) => (typeof v === "number" ? v : Number.NaN));
      bars.push({ tradingDate: toZonedDateString(instant, timezone), open, high, low, close, volume });
    }
    return { bars, unparseable };
  }
}
