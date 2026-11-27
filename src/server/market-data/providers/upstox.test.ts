import { describe, expect, it, vi } from "vitest";
import { UpstoxProvider } from "./upstox";
import { ProviderError, type DailyBarsRequest } from "@/lib/market-data/types";

// Shape captured from a real Upstox v3 daily response (newest first, 00:00 IST timestamps).
const REAL_SHAPE = {
  status: "success",
  data: {
    candles: [
      ["2026-11-20T00:00:00+05:30", 25368.0, 25808.8, 25345.2, 25800.6, 0, 0],
      ["2026-11-19T00:00:00+05:30", 25186.8, 25514.3, 25104.8, 25514.3, 0, 0],
      ["2026-11-18T00:00:00+05:30", 25323.15, 25390.8, 25141.8, 25227.95, 0, 0],
    ],
  },
};

const request = (over: Partial<DailyBarsRequest> = {}): DailyBarsRequest => ({
  instrument: { providerSymbol: "NSE_INDEX|Nifty 50", symbol: "NIFTY50", type: "INDEX", currency: "INR" },
  market: { code: "NSE", timezone: "Asia/Kolkata", currency: "INR" },
  fromDate: "2026-11-17",
  toDate: "2026-11-20",
  notAfter: new Date("2026-11-27T12:00:00Z"),
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("UpstoxProvider", () => {
  it("reports missing configuration without exposing values", () => {
    expect(new UpstoxProvider().status()).toMatchObject({ configured: false, missingEnv: ["UPSTOX_ACCESS_TOKEN"] });
    expect(new UpstoxProvider({ accessToken: "   " }).status().configured).toBe(false);
    const s = new UpstoxProvider({ accessToken: "secret-token" }).status();
    expect(s.configured).toBe(true);
    expect(JSON.stringify(s)).not.toContain("secret-token");
  });

  it("refuses to call the API without a token", async () => {
    const fetch = vi.fn();
    await expect(new UpstoxProvider({ fetch }).fetchDailyBars(request())).rejects.toMatchObject({ kind: "NOT_CONFIGURED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("builds the documented v3 URL with an encoded key and bearer token", async () => {
    const fetch = vi.fn(async () => jsonResponse(REAL_SHAPE));
    await new UpstoxProvider({ accessToken: "tok", fetch }).fetchDailyBars(request());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.upstox.com/v3/historical-candle/NSE_INDEX%7CNifty%2050/days/1/2026-11-20/2026-11-17");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("normalizes candles to IST trading dates in INR", async () => {
    const fetch = vi.fn(async () => jsonResponse(REAL_SHAPE));
    const r = await new UpstoxProvider({ accessToken: "tok", fetch }).fetchDailyBars(request());
    expect(r.source).toBe("upstox");
    expect(r.currency).toBe("INR");
    expect(r.unparseable).toBe(0);
    expect(r.bars[0]).toEqual({ tradingDate: "2026-11-20", open: 25368.0, high: 25808.8, low: 25345.2, close: 25800.6, volume: 0 });
    expect(r.bars.map((b) => b.tradingDate)).toEqual(["2026-11-20", "2026-11-19", "2026-11-18"]);
  });

  it("counts malformed rows instead of crashing", () => {
    const p = new UpstoxProvider({ accessToken: "tok" });
    const r = p.parse(
      { status: "success", data: { candles: [["not-a-date", 1, 2, 0.5, 1.5, 10, 0], [123], "x", ["2026-11-20T00:00:00+05:30", 1, 2, 0.5, "1.5", 10, 0]] } },
      "Asia/Kolkata",
    );
    expect(r.unparseable).toBe(3);
    expect(r.bars).toHaveLength(1);
    expect(Number.isNaN(r.bars[0].close)).toBe(true); // string price → NaN → rejected by validation
  });

  it("rejects an unexpected response shape", () => {
    expect(() => new UpstoxProvider({ accessToken: "tok" }).parse({ status: "error" }, "Asia/Kolkata")).toThrow(ProviderError);
  });

  it("maps HTTP errors to typed errors without leaking the token", async () => {
    const body = { status: "error", errors: [{ errorCode: "UDAPI100050", message: "Invalid token used to access API" }] };
    const p = new UpstoxProvider({ accessToken: "super-secret", fetch: vi.fn(async () => jsonResponse(body, 401)) });
    const err = await p.fetchDailyBars(request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: "UNAUTHORIZED", httpStatus: 401 });
    expect((err as ProviderError).stopsRun).toBe(true);
    expect((err as Error).message).toContain("UDAPI100050");
    expect((err as Error).message).not.toContain("super-secret");
  });

  it("maps 429 to RATE_LIMITED and 400 to INVALID_REQUEST", async () => {
    const mk = (status: number) => new UpstoxProvider({ accessToken: "t", fetch: vi.fn(async () => jsonResponse({}, status)) });
    await expect(mk(429).fetchDailyBars(request())).rejects.toMatchObject({ kind: "RATE_LIMITED" });
    await expect(mk(400).fetchDailyBars(request())).rejects.toMatchObject({ kind: "INVALID_REQUEST" });
  });

  it("maps network failures", async () => {
    const p = new UpstoxProvider({ accessToken: "t", fetch: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) });
    await expect(p.fetchDailyBars(request())).rejects.toMatchObject({ kind: "NETWORK" });
  });

  it("only supports NSE/BSE equity and index keys", () => {
    const p = new UpstoxProvider({ accessToken: "t" });
    expect(p.supports({ providerSymbol: "NSE_EQ|INE002A01018", symbol: "RELIANCE", type: "EQUITY", currency: "INR" })).toBe(true);
    expect(p.supports({ providerSymbol: "BSE_INDEX|SENSEX", symbol: "SENSEX", type: "INDEX", currency: "INR" })).toBe(true);
    expect(p.supports({ providerSymbol: "NSE_FO|12345", symbol: "X", type: "EQUITY", currency: "INR" })).toBe(false);
    expect(p.supports({ providerSymbol: "RELIANCE", symbol: "RELIANCE", type: "EQUITY", currency: "INR" })).toBe(false);
  });

  it("splits ranges longer than one decade into multiple requests", async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: "success", data: { candles: [] } }));
    await new UpstoxProvider({ accessToken: "t", fetch }).fetchDailyBars(request({ fromDate: "2005-01-01", toDate: "2026-11-20" }));
    expect(fetch).toHaveBeenCalledTimes(3);
    const urls = fetch.mock.calls.map((c) => (c as unknown as [string])[0]);
    const windows = urls.map((u) => u.split("/").slice(-2).reverse()); // [from, to]
    expect(windows).toEqual([
      ["2005-01-01", "2014-12-29"],
      ["2014-12-30", "2024-12-26"],
      ["2024-12-27", "2026-11-20"],
    ]);
    // Contiguous: each window starts the day after the previous one ends; none exceeds 3650 days.
    for (const [from, to] of windows) {
      expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBeLessThan(3650);
    }
  });
});
