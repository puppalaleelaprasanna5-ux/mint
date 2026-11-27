import { describe, expect, it, vi } from "vitest";
import { AlpacaProvider } from "./alpaca";
import { ProviderError, type DailyBarsRequest } from "@/lib/market-data/types";

// Shape per https://docs.alpaca.markets/reference/stockbars
const page1 = {
  bars: {
    AAPL: [
      { t: "2026-11-24T05:00:00Z", o: 270.1, h: 274.5, l: 269.2, c: 273.9, v: 1203345, n: 15000, vw: 272.1 },
      { t: "2026-11-25T05:00:00Z", o: 274.0, h: 276.0, l: 272.5, c: 275.2, v: 998001, n: 13000, vw: 274.4 },
    ],
  },
  next_page_token: "QUFQTHwyMDI2",
  currency: "USD",
};
const page2 = {
  bars: { AAPL: [{ t: "2026-11-26T05:00:00Z", o: 275.0, h: 277.0, l: 274.0, c: 276.5, v: 800000, n: 9000, vw: 276.0 }] },
  next_page_token: null,
};

const request = (over: Partial<DailyBarsRequest> = {}): DailyBarsRequest => ({
  instrument: { providerSymbol: "AAPL", symbol: "AAPL", type: "EQUITY", currency: "USD" },
  market: { code: "NASDAQ", timezone: "America/New_York", currency: "USD" },
  fromDate: "2026-11-24",
  toDate: "2026-11-26",
  notAfter: new Date("2026-11-27T12:00:00Z"),
  ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const configured = (fetch: ReturnType<typeof vi.fn>, feed?: string) =>
  new AlpacaProvider({ keyId: "KEYID", secretKey: "SECRET", feed, fetch: fetch as never });

describe("AlpacaProvider", () => {
  it("reports each missing env var", () => {
    expect(new AlpacaProvider().status().missingEnv).toEqual(["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"]);
    expect(new AlpacaProvider({ keyId: "k" }).status().missingEnv).toEqual(["ALPACA_API_SECRET_KEY"]);
  });

  it("defaults to the IEX feed and rejects unknown feeds", () => {
    expect(new AlpacaProvider({ keyId: "k", secretKey: "s" }).status()).toMatchObject({ configured: true, source: "alpaca-iex" });
    expect(new AlpacaProvider({ keyId: "k", secretKey: "s", feed: "SIP" }).status().source).toBe("alpaca-sip");
    const bad = new AlpacaProvider({ keyId: "k", secretKey: "s", feed: "delayed" }).status();
    expect(bad.configured).toBe(false);
    expect(bad.notes.join(" ")).toMatch(/invalid/);
  });

  it("does not expose credentials in status", () => {
    expect(JSON.stringify(new AlpacaProvider({ keyId: "KEYID", secretKey: "SECRET" }).status())).not.toMatch(/KEYID|SECRET"/);
  });

  it("refuses to call without credentials", async () => {
    const fetch = vi.fn();
    await expect(new AlpacaProvider({ fetch }).fetchDailyBars(request())).rejects.toMatchObject({ kind: "NOT_CONFIGURED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not support indices", () => {
    const p = new AlpacaProvider({ keyId: "k", secretKey: "s" });
    expect(p.supports({ providerSymbol: "SPX", symbol: "SPX", type: "INDEX", currency: "USD" })).toBe(false);
    expect(p.supports({ providerSymbol: "AAPL", symbol: "AAPL", type: "EQUITY", currency: "USD" })).toBe(true);
  });

  it("sends documented params and auth headers, and follows pagination", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(page1)).mockResolvedValueOnce(json(page2));
    const r = await configured(fetch).fetchDailyBars(request());
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url1, init] = fetch.mock.calls[0] as [string, RequestInit];
    const u = new URL(url1);
    expect(u.origin + u.pathname).toBe("https://data.alpaca.markets/v2/stocks/bars");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      symbols: "AAPL",
      timeframe: "1Day",
      start: "2026-11-24",
      end: "2026-11-26",
      feed: "iex",
      adjustment: "split",
      limit: "10000",
    });
    expect(init.headers).toMatchObject({ "APCA-API-KEY-ID": "KEYID", "APCA-API-SECRET-KEY": "SECRET" });
    expect(new URL((fetch.mock.calls[1] as [string])[0]).searchParams.get("page_token")).toBe("QUFQTHwyMDI2");

    expect(r.source).toBe("alpaca-iex");
    expect(r.currency).toBe("USD");
    expect(r.bars.map((b) => b.tradingDate)).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
    expect(r.bars[0]).toEqual({ tradingDate: "2026-11-24", open: 270.1, high: 274.5, low: 269.2, close: 273.9, volume: 1203345 });
  });

  it("derives New York trading dates across DST (04:00Z summer, 05:00Z winter)", () => {
    const p = new AlpacaProvider({ keyId: "k", secretKey: "s" });
    const r = p.parse(
      { bars: { AAPL: [{ t: "2026-07-15T04:00:00Z", o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: "2026-01-15T05:00:00Z", o: 1, h: 1, l: 1, c: 1, v: 1 }] } },
      "AAPL",
      "America/New_York",
    );
    expect(r.bars.map((b) => b.tradingDate)).toEqual(["2026-07-15", "2026-01-15"]);
  });

  it("handles empty / null bars and malformed rows", () => {
    const p = new AlpacaProvider({ keyId: "k", secretKey: "s" });
    expect(p.parse({ bars: null, next_page_token: null }, "AAPL", "America/New_York").bars).toEqual([]);
    expect(p.parse({ bars: {} }, "AAPL", "America/New_York").bars).toEqual([]);
    const r = p.parse({ bars: { AAPL: [{ t: 5 }, null, { t: "bad" }] } }, "AAPL", "America/New_York");
    expect(r.unparseable).toBe(3);
    expect(() => p.parse({ message: "x" }, "AAPL", "America/New_York")).toThrow(ProviderError);
  });

  it("explains 403 (plan/feed) errors and stops the run", async () => {
    const fetch = vi.fn(async () => json({ message: "subscription does not permit querying recent SIP data" }, 403));
    const err = (await configured(fetch, "sip").fetchDailyBars(request()).catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe("FORBIDDEN");
    expect(err.stopsRun).toBe(true);
    expect(err.message).toMatch(/subscription does not permit/);
    expect(err.message).toMatch(/ALPACA_DATA_FEED=iex/);
    expect(err.message).not.toMatch(/SECRET|KEYID/);
    expect(fetch).toHaveBeenCalledTimes(1); // no silent retry on another feed
  });

  it("maps 401 and 422", async () => {
    await expect(configured(vi.fn(async () => json({ message: "unauthorized." }, 401))).fetchDailyBars(request())).rejects.toMatchObject({
      kind: "UNAUTHORIZED",
    });
    await expect(configured(vi.fn(async () => json({ message: "invalid start" }, 422))).fetchDailyBars(request())).rejects.toMatchObject({
      kind: "INVALID_REQUEST",
    });
  });

  it("treats non-JSON success bodies as BAD_RESPONSE", async () => {
    const fetch = vi.fn(async () => new Response("<html>oops</html>", { status: 200 }));
    await expect(configured(fetch).fetchDailyBars(request())).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });
});
