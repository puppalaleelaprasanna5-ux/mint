/**
 * SEC EDGAR lookup tests. All HTTP is mocked with fixtures that are verbatim excerpts of SEC's
 * own files (company_tickers_exchange.json and Apple's submissions JSON, fetched 2026-11-28).
 * A global fetch guard fails the test if anything tries to reach the real network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tickersFixture from "./__fixtures__/sec-company-tickers-exchange.json";
import aaplFixture from "./__fixtures__/sec-submissions-aapl.json";
import { isValidSecUserAgent, padCik, resetSecEdgarState, SecEdgarProvider, toSecTicker, type SecEdgarConfig } from "./sec-edgar";
import { lookupCompany } from "../company-lookup";
import { createCompanyLookupProvider } from "../company-registry";
import { classifyFilingForm } from "@/lib/fundamentals/company";
import type { FundamentalsInstrumentRef } from "@/lib/fundamentals/types";

const UA = "Mint test-suite ops@mint.test";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const AAPL_URL = "https://data.sec.gov/submissions/CIK0000320193.json";
const AAPL: FundamentalsInstrumentRef = { symbol: "AAPL", market: "NASDAQ", type: "EQUITY", currency: "USD" };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** Fake SEC: serves the fixtures; anything else is a 404. Records every call. */
function fakeSec(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    if (overrides[url]) return overrides[url]();
    if (url === TICKERS_URL) return json(tickersFixture);
    if (url === AAPL_URL) return json(aaplFixture);
    return new Response("Not Found", { status: 404 });
  });
  return { fetch, calls };
}

let t: number;
let sleeps: number[];
const clock = (): Pick<SecEdgarConfig, "now" | "sleep"> => ({
  now: () => t,
  sleep: async (ms) => {
    sleeps.push(ms);
    t += ms;
  },
});
const sec = (fetch: SecEdgarConfig["fetch"], extra: SecEdgarConfig = {}) => new SecEdgarProvider({ userAgent: UA, fetch, ...clock(), ...extra });

beforeEach(() => {
  resetSecEdgarState();
  t = Date.parse("2026-11-28T00:00:00Z");
  sleeps = [];
  vi.stubGlobal("fetch", () => {
    throw new Error("Real network call attempted in a test");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("User-Agent (SEC fair access)", () => {
  it.each([
    ["Mint personal research you@yourdomain.com", true],
    ["Acme Research Ltd admin@acme.co.in", true],
    [undefined, false],
    ["", false],
    ["Mint research", false], // no contact email
    ["ops@mint.test", false], // no name
    ["Sample Company Name AdminContact@<sample company domain>.com", false], // SEC's placeholder
    ["Mint test me@example.com", false], // placeholder domain
    ["Mint\nInjected-Header: x ops@mint.test", false],
    [`Mint ${"x".repeat(200)} ops@mint.test`, false],
  ])("%j → %s", (value, valid) => {
    expect(isValidSecUserAgent(value)).toBe(valid);
  });

  it("refuses to call SEC without a valid User-Agent", async () => {
    const { fetch } = fakeSec();
    const p = new SecEdgarProvider({ userAgent: "no contact", fetch });
    expect(p.status()).toMatchObject({ configured: false, missingEnv: ["SEC_USER_AGENT"] });
    expect(await lookupCompany(p, AAPL)).toMatchObject({ status: "error", code: "NOT_CONFIGURED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the configured User-Agent on every request and never echoes it", async () => {
    const { fetch, calls } = fakeSec();
    const p = sec(fetch);
    const r = await lookupCompany(p, AAPL);
    expect(calls.map((c) => c.headers["User-Agent"])).toEqual([UA, UA]);
    expect(calls[0].headers).toMatchObject({ Accept: "application/json", "Accept-Encoding": "gzip, deflate" });
    expect(JSON.stringify(p.status())).not.toContain("ops@mint.test");
    expect(JSON.stringify(r)).not.toContain("ops@mint.test");
  });
});

describe("ticker → CIK and company identity", () => {
  it("resolves AAPL to CIK 0000320193 using the documented endpoints", async () => {
    const { fetch, calls } = fakeSec();
    const r = await lookupCompany(sec(fetch), AAPL);
    expect(calls.map((c) => c.url)).toEqual([TICKERS_URL, AAPL_URL]);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.identity).toMatchObject({
      source: "sec-edgar",
      identifiers: { cik: "0000320193" },
      name: "Apple Inc.",
      tickers: ["AAPL"],
      exchanges: ["Nasdaq"],
      entityType: "operating",
      sic: "3571",
      sicDescription: "Electronic Computers",
      fiscalYearEnd: "09-25", // SEC reports "0925"
      stateOfIncorporation: "CA",
    });
    expect(r.identity.formerNames[0]).toEqual({ name: "APPLE INC", from: "2007-01-10T00:00:00.000Z", to: "2019-08-05T00:00:00.000Z" });
    expect(r).toMatchObject({ listedExchange: "Nasdaq", exchangeMatches: true, provider: "SEC EDGAR" });
  });

  it("flags an exchange mismatch instead of guessing", async () => {
    const r = await lookupCompany(sec(fakeSec().fetch), { ...AAPL, market: "NYSE" });
    expect(r).toMatchObject({ status: "ok", listedExchange: "Nasdaq", exchangeMatches: false });
  });

  it("maps share-class tickers to SEC's dash format (BRK.B → BRK-B → CIK 0001067983)", async () => {
    expect(toSecTicker("brk.b")).toBe("BRK-B");
    expect(toSecTicker("BF/B")).toBe("BF-B");
    expect(padCik(1067983)).toBe("0001067983");
    const { fetch, calls } = fakeSec();
    await lookupCompany(sec(fetch), { ...AAPL, symbol: "BRK.B", market: "NYSE" });
    expect(calls[1].url).toBe("https://data.sec.gov/submissions/CIK0001067983.json");
  });

  it("parses rows with a null exchange (SEC has ~157 of them)", async () => {
    const { fetch, calls } = fakeSec();
    await lookupCompany(sec(fetch), { ...AAPL, symbol: "CORE" });
    expect(calls[1].url).toBe(`https://data.sec.gov/submissions/CIK${padCik(tickersFixture.data.find((r) => r[2] === "CORE")![0] as number)}.json`);
  });

  it("returns not_found for unknown tickers after only the ticker file", async () => {
    const { fetch, calls } = fakeSec();
    expect(await lookupCompany(sec(fetch), { ...AAPL, symbol: "ZZZZNOPE" })).toMatchObject({ status: "not_found" });
    expect(calls.map((c) => c.url)).toEqual([TICKERS_URL]);
  });

  it("returns not_found when SEC has no submissions for the CIK (404)", async () => {
    expect(await lookupCompany(sec(fakeSec().fetch), { ...AAPL, symbol: "MSFT" })).toMatchObject({ status: "not_found" });
  });

  it("does not call SEC for non-US listings, indices or funds", async () => {
    const { fetch } = fakeSec();
    const p = sec(fetch);
    expect(await lookupCompany(p, { symbol: "TCS", market: "NSE", type: "EQUITY", currency: "INR" })).toMatchObject({ status: "unsupported" });
    expect(await lookupCompany(p, { ...AAPL, symbol: "SPX", type: "INDEX" })).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/index/) });
    expect(await lookupCompany(p, { ...AAPL, type: "ETF" })).toMatchObject({ status: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("filing metadata", () => {
  it("keeps only periodic reports (10-K/10-Q), newest first, with SEC archive links", async () => {
    const r = await lookupCompany(sec(fakeSec().fetch), AAPL);
    if (r.status !== "ok") throw new Error(r.status);
    const f = r.filings.filings;
    expect(f.map((x) => x.form)).toEqual(["10-K", "10-Q", "10-Q", "10-Q", "10-K"]); // 144, 4 and 8-K dropped
    expect(f.map((x) => x.filingDate)).toEqual([...f.map((x) => x.filingDate)].sort().reverse());
    expect(f[0]).toEqual({
      form: "10-K",
      category: "annual",
      isAmendment: false,
      accessionNumber: "0000320193-26-000026",
      filingDate: "2026-11-03",
      reportDate: "2026-09-26",
      primaryDocument: "aapl-20260926.htm",
      isXbrl: true,
      isInlineXbrl: true,
      indexUrl: "https://www.sec.gov/Archives/edgar/data/320193/0000320193-26-000026-index.html",
      documentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm",
    });
    expect(f[1]).toMatchObject({ form: "10-Q", category: "quarterly", reportDate: "2026-06-27" });
    expect(r.filings.coveredTo).toBe("2026-11-27");
    expect(r.filings.olderFilingsNotLoaded).toBe(true); // Apple's "files" lists an older batch
  });

  it("flags amendments and keeps blank report dates as null", async () => {
    const amended = structuredClone(aaplFixture);
    const i = amended.filings.recent.form.indexOf("10-Q");
    amended.filings.recent.form[i] = "10-Q/A";
    amended.filings.recent.reportDate[i] = "";
    const r = await lookupCompany(sec(fakeSec({ [AAPL_URL]: () => json(amended) }).fetch), AAPL);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.filings.filings.find((x) => x.form === "10-Q/A")).toMatchObject({ category: "quarterly", isAmendment: true, reportDate: null });
  });

  it.each([
    ["10-K", { category: "annual", isAmendment: false }],
    ["10-K/A", { category: "annual", isAmendment: true }],
    ["20-F", { category: "annual", isAmendment: false }],
    ["40-F", { category: "annual", isAmendment: false }],
    ["10-Q", { category: "quarterly", isAmendment: false }],
    ["8-K", null],
    ["144", null],
    ["DEF 14A", null],
  ])("classifies form %s", (form, expected) => {
    expect(classifyFilingForm(form)).toEqual(expected);
  });
});

describe("caching", () => {
  it("serves repeat lookups from cache and refreshes after the TTLs", async () => {
    const { fetch, calls } = fakeSec();
    const p = sec(fetch);
    await lookupCompany(p, AAPL);
    await lookupCompany(p, AAPL);
    expect(calls).toHaveLength(2); // ticker file + submissions, once each

    t += 3_600_001; // company data (1 h) expired, ticker file (24 h) still fresh
    await lookupCompany(p, AAPL);
    expect(calls.map((c) => c.url).slice(2)).toEqual([AAPL_URL]);

    t += 24 * 3_600_000; // both expired
    await lookupCompany(p, AAPL);
    expect(calls.map((c) => c.url).slice(3)).toEqual([TICKERS_URL, AAPL_URL]);
  });

  it("shares caches across provider instances (one per request in the app)", async () => {
    const { fetch, calls } = fakeSec();
    await lookupCompany(sec(fetch), AAPL);
    await lookupCompany(sec(fetch), AAPL);
    expect(calls).toHaveLength(2);
  });

  it("de-duplicates concurrent lookups into one download each", async () => {
    const { fetch, calls } = fakeSec();
    const p = sec(fetch);
    const results = await Promise.all([lookupCompany(p, AAPL), lookupCompany(p, AAPL), lookupCompany(p, AAPL)]);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    expect(calls).toHaveLength(2);
  });
});

describe("fair-access throttle and refusals", () => {
  it("spaces requests at least 125 ms apart (≤ 8/s, under SEC's 10/s)", async () => {
    const { fetch } = fakeSec();
    await lookupCompany(sec(fetch), AAPL);
    expect(sleeps).toEqual([125]); // 2nd request waited for its slot
  });

  it("pauses all SEC requests after a 403, then resumes", async () => {
    const { fetch } = fakeSec({ [TICKERS_URL]: () => new Response("Forbidden", { status: 403 }) });
    const r = await lookupCompany(sec(fetch), AAPL);
    expect(r).toMatchObject({ status: "error", code: "FORBIDDEN", reason: expect.stringMatching(/SEC_USER_AGENT.*Pausing SEC requests for 60s/) });

    const healthy = fakeSec();
    t += 30_000;
    expect(await lookupCompany(sec(healthy.fetch), AAPL)).toMatchObject({ status: "error", code: "RATE_LIMITED", reason: expect.stringMatching(/30s/) });
    expect(healthy.fetch).not.toHaveBeenCalled();

    t += 31_000;
    expect((await lookupCompany(sec(healthy.fetch), AAPL)).status).toBe("ok");
  });

  it("honours Retry-After on 429", async () => {
    const { fetch } = fakeSec({ [TICKERS_URL]: () => new Response("", { status: 429, headers: { "retry-after": "5" } }) });
    expect(await lookupCompany(sec(fetch), AAPL)).toMatchObject({ status: "error", code: "RATE_LIMITED", reason: expect.stringMatching(/5s/) });
  });
});

describe("errors and timeouts (never thrown)", () => {
  it.each([
    ["server error", () => new Response("oops", { status: 503 }), "PROVIDER_ERROR", /temporarily unavailable/],
    ["non-JSON body", () => new Response("<html>maintenance</html>", { status: 200 }), "INVALID_RESPONSE", /not valid JSON/],
    ["unexpected shape", () => json({ rows: [] }), "INVALID_RESPONSE", /unexpected format/],
    ["missing columns", () => json({ fields: ["cik", "name"], data: [] }), "INVALID_RESPONSE", /missing expected columns/],
  ])("ticker file: %s", async (_label, respond, code, reason) => {
    const r = await lookupCompany(sec(fakeSec({ [TICKERS_URL]: respond }).fetch), AAPL);
    expect(r).toMatchObject({ status: "error", code, reason: expect.stringMatching(reason) });
  });

  it("rejects misaligned filing arrays instead of mis-attributing filings", async () => {
    const broken = structuredClone(aaplFixture);
    broken.filings.recent.form.pop();
    const r = await lookupCompany(sec(fakeSec({ [AAPL_URL]: () => json(broken) }).fetch), AAPL);
    expect(r).toMatchObject({ status: "error", code: "INVALID_RESPONSE", reason: expect.stringMatching(/misaligned/) });
  });

  it("maps network failures", async () => {
    const r = await lookupCompany(sec(vi.fn(async () => Promise.reject(new TypeError("fetch failed")))), AAPL);
    expect(r).toEqual({ status: "error", code: "PROVIDER_ERROR", reason: "Network error contacting SEC.", provider: "SEC EDGAR" });
  });

  it("times out a hanging request", async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    );
    const r = await lookupCompany(sec(hanging, { timeoutMs: 30 }), AAPL);
    expect(r).toMatchObject({ status: "error", code: "TIMEOUT", reason: expect.stringMatching(/did not respond/) });
  });

  it("respects a caller's cancellation without calling SEC", async () => {
    const { fetch } = fakeSec();
    const controller = new AbortController();
    controller.abort();
    expect(await lookupCompany(sec(fetch), AAPL, { signal: controller.signal })).toMatchObject({ status: "error", code: "TIMEOUT" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hides unexpected errors", async () => {
    const r = await lookupCompany(
      { id: "x", name: "X", status: () => ({ id: "x", name: "X", configured: true, missingEnv: [], notes: [] }), supports: () => true, lookup: () => { throw new Error("secret detail"); } },
      AAPL,
    );
    expect(r).toEqual({ status: "error", code: "PROVIDER_ERROR", reason: "Company lookup failed unexpectedly.", provider: "X" });
  });
});

describe("createCompanyLookupProvider", () => {
  it("is off until SEC_USER_AGENT is set", async () => {
    const r = createCompanyLookupProvider({});
    expect(r.provider).toBeNull();
    expect(r.status.notes[0]).toMatch(/Set SEC_USER_AGENT/);
    expect(await lookupCompany(r.provider, AAPL, { disabledReason: r.status.notes[0] })).toMatchObject({ status: "disabled" });
  });

  it("explains an invalid value without echoing it", () => {
    const r = createCompanyLookupProvider({ SEC_USER_AGENT: "private-value-without-email" });
    expect(r.provider).toBeNull();
    expect(r.status.notes[0]).toMatch(/invalid/);
    expect(JSON.stringify(r.status)).not.toContain("private-value-without-email");
  });

  it("enables SEC EDGAR with a valid value", () => {
    const r = createCompanyLookupProvider({ SEC_USER_AGENT: UA });
    expect(r.provider).toBeInstanceOf(SecEdgarProvider);
    expect(r.status.configured).toBe(true);
    expect(JSON.stringify(r.status)).not.toContain("ops@mint.test");
  });
});
