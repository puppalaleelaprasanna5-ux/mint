/**
 * Alpaca adapter — US stocks (NASDAQ/NYSE), daily historical bars.
 *
 * API: GET https://data.alpaca.markets/v2/stocks/bars
 * Docs: https://docs.alpaca.markets/reference/stockbars
 *   - headers APCA-API-KEY-ID / APCA-API-SECRET-KEY; timeframe=1Day; limit ≤ 10000; paginate with
 *     next_page_token; response {bars: {SYMBOL: [{t,o,h,l,c,v,n,vw}]}, next_page_token}
 * Feeds (https://docs.alpaca.markets/docs/historical-stock-data-1): "iex" is documented as "the only
 * feed that can be used without a subscription", so it is the default. "sip" (full-market volume) is
 * opt-in via ALPACA_DATA_FEED=sip; if Alpaca refuses it, the sync reports the error — it never
 * silently falls back to another feed.
 * Alpaca provides stocks and ETFs only; market indices (S&P 500, NASDAQ Composite) are not available.
 *
 * Daily-bar timestamp semantics are not stated in the docs; the trading date is derived by
 * converting `t` to America/New_York, and validation rejects any bar that lands on a weekend.
 */
import { toZonedDateString } from "@/lib/time";
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

export type AlpacaFeed = "iex" | "sip";
const MAX_PAGES = 50;

export interface AlpacaConfig {
  keyId?: string;
  secretKey?: string;
  feed?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

function describeAlpacaError(status: number, body: unknown): string {
  const detail = isRecord(body) && body.message ? clip(body.message) : `HTTP ${status}`;
  if (status === 401) return `Alpaca rejected the API key (${detail}). Check ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY.`;
  if (status === 403)
    return `Alpaca denied access (${detail}). Your plan may not include this feed; the free plan supports ALPACA_DATA_FEED=iex.`;
  if (status === 429) return `Alpaca rate limit reached (${detail}). Try again later.`;
  return `Alpaca request failed (${detail})`;
}

export class AlpacaProvider implements MarketDataProvider {
  readonly id = "alpaca" as const;
  readonly name = "Alpaca";
  readonly regions: ("IN" | "US")[] = ["US"];
  private readonly keyId?: string;
  private readonly secretKey?: string;
  private readonly feed: AlpacaFeed | null;
  private readonly rawFeed: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: AlpacaConfig = {}) {
    this.keyId = config.keyId?.trim() || undefined;
    this.secretKey = config.secretKey?.trim() || undefined;
    this.rawFeed = (config.feed?.trim() || "iex").toLowerCase();
    this.feed = this.rawFeed === "iex" || this.rawFeed === "sip" ? this.rawFeed : null;
    this.baseUrl = (config.baseUrl ?? "https://data.alpaca.markets").replace(/\/$/, "");
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  }

  get source(): string | null {
    return this.feed ? `alpaca-${this.feed}` : null;
  }

  status(): ProviderStatus {
    const missingEnv = [
      ...(this.keyId ? [] : ["ALPACA_API_KEY_ID"]),
      ...(this.secretKey ? [] : ["ALPACA_API_SECRET_KEY"]),
    ];
    const notes = [
      "Daily bars for US stocks. Market indices (S&P 500, NASDAQ Composite) are not available from Alpaca and stay simulated.",
      "Prices are split-adjusted (adjustment=split).",
    ];
    if (this.feed === "iex") {
      notes.push("Feed: IEX (no subscription needed). Volume counts IEX trades only, a small share of total US volume.");
    } else if (this.feed === "sip") {
      notes.push("Feed: SIP (full-market). Requires a plan that permits SIP historical data.");
    } else {
      notes.push(`ALPACA_DATA_FEED="${clip(this.rawFeed, 20)}" is invalid; use "iex" or "sip".`);
    }
    return {
      id: this.id,
      name: this.name,
      regions: this.regions,
      configured: missingEnv.length === 0 && this.feed !== null,
      missingEnv,
      source: this.source,
      notes,
    };
  }

  supports(instrument: ProviderInstrumentRef): boolean {
    return instrument.type !== "INDEX" && /^[A-Z][A-Z0-9.]{0,9}$/.test(instrument.providerSymbol);
  }

  async fetchDailyBars(req: DailyBarsRequest): Promise<DailyBarsResult> {
    if (!this.keyId || !this.secretKey) {
      throw new ProviderError(this.id, "NOT_CONFIGURED", "ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY are not set");
    }
    if (!this.feed) {
      throw new ProviderError(this.id, "NOT_CONFIGURED", 'ALPACA_DATA_FEED must be "iex" or "sip"');
    }
    if (!this.supports(req.instrument)) {
      throw new ProviderError(this.id, "INVALID_REQUEST", `Alpaca does not provide data for ${req.instrument.symbol}`);
    }
    if (req.fromDate > req.toDate) {
      throw new ProviderError(this.id, "INVALID_REQUEST", "fromDate is after toDate");
    }

    const symbol = req.instrument.providerSymbol;
    const bars: NormalizedDailyBar[] = [];
    let unparseable = 0;
    let currency = "USD";
    let pageToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        symbols: symbol,
        timeframe: "1Day",
        start: req.fromDate,
        end: req.toDate,
        limit: "10000",
        adjustment: "split",
        feed: this.feed,
        sort: "asc",
      });
      if (pageToken) params.set("page_token", pageToken);
      const body = await getJson(
        this.id,
        this.fetchImpl,
        `${this.baseUrl}/v2/stocks/bars?${params}`,
        { Accept: "application/json", "APCA-API-KEY-ID": this.keyId, "APCA-API-SECRET-KEY": this.secretKey },
        describeAlpacaError,
      );
      const parsed = this.parse(body, symbol, req.market.timezone);
      bars.push(...parsed.bars);
      unparseable += parsed.unparseable;
      if (parsed.currency) currency = parsed.currency;
      pageToken = parsed.nextPageToken;
      if (!pageToken) break;
      if (page === MAX_PAGES - 1) {
        throw new ProviderError(this.id, "BAD_RESPONSE", "Too many result pages; narrow the date range");
      }
    }

    return {
      source: `alpaca-${this.feed}`,
      currency,
      bars,
      unparseable,
      notes: this.feed === "iex" ? ["Volume reflects IEX trades only."] : [],
    };
  }

  /** Exposed for unit tests. */
  parse(
    body: unknown,
    symbol: string,
    timezone: string,
  ): { bars: NormalizedDailyBar[]; unparseable: number; nextPageToken: string | null; currency: string | null } {
    if (!isRecord(body) || !("bars" in body)) {
      throw new ProviderError(this.id, "BAD_RESPONSE", "Unexpected Alpaca response shape (expected bars)");
    }
    const all = body.bars;
    // `bars` is an object keyed by symbol; it may be null/empty when there is no data.
    const rows: unknown[] = isRecord(all) && Array.isArray(all[symbol]) ? (all[symbol] as unknown[]) : [];
    const bars: NormalizedDailyBar[] = [];
    let unparseable = 0;
    for (const row of rows) {
      if (!isRecord(row) || typeof row.t !== "string") {
        unparseable++;
        continue;
      }
      const instant = new Date(row.t);
      if (Number.isNaN(instant.getTime())) {
        unparseable++;
        continue;
      }
      const num = (v: unknown) => (typeof v === "number" ? v : Number.NaN);
      bars.push({
        tradingDate: toZonedDateString(instant, timezone),
        open: num(row.o),
        high: num(row.h),
        low: num(row.l),
        close: num(row.c),
        volume: num(row.v),
      });
    }
    const nextPageToken = typeof body.next_page_token === "string" && body.next_page_token ? body.next_page_token : null;
    const currency = typeof body.currency === "string" && body.currency ? body.currency : null;
    return { bars, unparseable, nextPageToken, currency };
  }
}
