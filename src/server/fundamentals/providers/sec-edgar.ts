/**
 * SEC EDGAR company lookup (US-listed companies): ticker → CIK, company identity and periodic
 * filing metadata. No API key. Server-side only.
 *
 * Sources (official SEC documentation):
 * - https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 *   data.sec.gov JSON APIs, no authentication; submissions at
 *   https://data.sec.gov/submissions/CIK##########.json (10-digit CIK incl. leading zeros);
 *   "filings.recent" holds ≥1 year or up to 1,000 filings as parallel (columnar) arrays;
 *   "filings.files" lists additional JSON files with older filings.
 * - https://www.sec.gov/os/accessing-edgar-data
 *   Fair access: "Current max request rate: 10 requests/second"; declare a User-Agent such as
 *   "Sample Company Name AdminContact@<sample company domain>.com". Lists the ticker files
 *   company_tickers_exchange.json ({"fields":["cik","name","ticker","exchange"],"data":[...]}).
 *   Archive folders: /Archives/edgar/data/{CIK}/{accession without dashes}/…, index pages at
 *   /Archives/edgar/data/{CIK}/{accession}-index.html.
 *
 * Verified against live responses (2026-11-28): share-class tickers use "-" (BRK-B), some rows
 * have a null exchange, fiscalYearEnd is "MMDD", isXBRL/isInlineXBRL are 0/1 numbers.
 *
 * Fair-access measures here: requests spaced ≥125 ms apart (~8/s, under SEC's 10/s), a pause
 * after 403/429, a 24 h cache for the ticker file and a 1 h cache per company.
 */
import { z } from "zod";
import { classifyFilingForm, type CompanyFilings, type CompanyIdentity, type FilingSummary } from "@/lib/fundamentals/company";
import type { FundamentalsInstrumentRef } from "@/lib/fundamentals/types";
import type { CompanyLookupProvider, CompanyLookupStatus, CompanyMatch } from "../company-lookup";
import { FundamentalsError } from "../provider";

export const SEC_EDGAR_SOURCE = "sec-edgar";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions";
/** CompanyFacts: https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json (SEC API docs). */
const XBRL_URL = "https://data.sec.gov/api/xbrl";
const ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data";

/** SEC exchange names → Mint market codes. Others (OTC, CBOE, TXSE, null) are not Mint markets. */
const EXCHANGE_TO_MARKET: Record<string, string> = { Nasdaq: "NASDAQ", NYSE: "NYSE" };
const SUPPORTED_MARKETS = new Set(["NASDAQ", "NYSE"]);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SecEdgarConfig {
  userAgent?: string;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  minIntervalMs?: number;
  tickersTtlMs?: number;
  submissionsTtlMs?: number;
  maxCachedCompanies?: number;
}

// ───────────────────────────── User-Agent ─────────────────────────────

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PLACEHOLDER = /@(?:example\.(?:com|org|net)|<|.*sample)|AdminContact@/i;

/**
 * SEC asks automated clients to declare who they are: an application/company name AND a contact
 * email, e.g. "Mint personal research you@yourdomain.com". Placeholder addresses are rejected.
 */
export function isValidSecUserAgent(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length < 8 || v.length > 200 || /[\r\n\t\x00-\x1f]/.test(v)) return false;
  const email = EMAIL.exec(v);
  if (!email || PLACEHOLDER.test(v)) return false;
  return v.replace(email[0], "").trim().length > 0; // a name besides the email
}

// ───────────────────────────── Shared process state ─────────────────────────────
// Providers are created per request (see registry), so throttling, cooldown and caches live at
// module level and are shared by every instance in this server process.

interface TickerEntry {
  cik: number;
  name: string;
  ticker: string;
  exchange: string | null;
}
let tickerCache: { expiresAt: number; byTicker: Map<string, TickerEntry> } | null = null;
let tickerInflight: Promise<Map<string, TickerEntry>> | null = null;
const submissionsCache = new Map<number, { expiresAt: number; value: SecSubmissions | null }>();
const submissionsInflight = new Map<number, Promise<SecSubmissions | null>>();
let nextRequestAt = 0;
let cooldownUntil = 0;

/** For tests. */
export function resetSecEdgarState(): void {
  tickerCache = null;
  tickerInflight = null;
  submissionsCache.clear();
  submissionsInflight.clear();
  nextRequestAt = 0;
  cooldownUntil = 0;
}

// ───────────────────────────── Response schemas (verified shapes) ─────────────────────────────

const tickersSchema = z.object({
  fields: z.array(z.string()),
  data: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});

const recentSchema = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  reportDate: z.array(z.string()),
  form: z.array(z.string()),
  primaryDocument: z.array(z.string()),
  isXBRL: z.array(z.number()),
  isInlineXBRL: z.array(z.number()),
});

const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]),
  name: z.string().min(1),
  entityType: z.string().nullish(),
  sic: z.string().nullish(),
  sicDescription: z.string().nullish(),
  tickers: z.array(z.string()).default([]),
  exchanges: z.array(z.string().nullable()).default([]),
  fiscalYearEnd: z.string().nullish(),
  stateOfIncorporation: z.string().nullish(),
  formerNames: z.array(z.object({ name: z.string(), from: z.string().nullish(), to: z.string().nullish() })).default([]),
  filings: z.object({ recent: recentSchema, files: z.array(z.unknown()).default([]) }),
});
type SecSubmissions = z.infer<typeof submissionsSchema>;

// ───────────────────────────── Helpers ─────────────────────────────

/** Mint/other ticker spellings → SEC's: upper-case, share-class separator "." or "/" → "-". */
export function toSecTicker(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[./]/g, "-");
}

export function padCik(cik: number | string): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

function fiscalYearEnd(raw: string | null | undefined): string | null {
  return raw && /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(raw) ? `${raw.slice(0, 2)}-${raw.slice(2)}` : null;
}

function docUrl(cik: number, accession: string, primaryDocument: string): string {
  const path = primaryDocument.split("/").map(encodeURIComponent).join("/");
  return `${ARCHIVES_URL}/${cik}/${accession.replace(/-/g, "")}/${path}`;
}

// ───────────────────────────── Provider ─────────────────────────────

export class SecEdgarProvider implements CompanyLookupProvider {
  readonly id = SEC_EDGAR_SOURCE;
  readonly name = "SEC EDGAR";
  readonly #userAgent: string | undefined;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #minIntervalMs: number;
  readonly #tickersTtlMs: number;
  readonly #submissionsTtlMs: number;
  readonly #maxCached: number;

  constructor(config: SecEdgarConfig = {}) {
    this.#userAgent = config.userAgent && isValidSecUserAgent(config.userAgent) ? config.userAgent.trim() : undefined;
    this.#fetch = config.fetch ?? ((input, init) => fetch(input, init));
    this.#now = config.now ?? Date.now;
    this.#sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#timeoutMs = config.timeoutMs ?? 10_000;
    this.#minIntervalMs = config.minIntervalMs ?? 125;
    this.#tickersTtlMs = config.tickersTtlMs ?? 24 * 3_600_000;
    this.#submissionsTtlMs = config.submissionsTtlMs ?? 3_600_000;
    this.#maxCached = config.maxCachedCompanies ?? 100;
  }

  status(): CompanyLookupStatus {
    return {
      id: this.id,
      name: this.name,
      configured: Boolean(this.#userAgent),
      missingEnv: this.#userAgent ? [] : ["SEC_USER_AGENT"],
      notes: [
        "US-listed companies only (NASDAQ/NYSE). No API key; SEC requires a User-Agent with your contact email.",
        "Requests are limited to ~8/second (SEC allows 10) and cached (ticker list 24 h, company data 1 h).",
      ],
    };
  }

  supports(ref: FundamentalsInstrumentRef): boolean {
    return ref.type === "EQUITY" && SUPPORTED_MARKETS.has(ref.market);
  }

  async lookup(ref: FundamentalsInstrumentRef, { signal }: { signal?: AbortSignal } = {}): Promise<CompanyMatch | null> {
    if (!this.#userAgent) {
      throw new FundamentalsError("NOT_CONFIGURED", 'SEC_USER_AGENT is not set or invalid. Use "<app name> <your contact email>".');
    }
    if (!this.supports(ref)) return null;
    // Downloads are shared between concurrent callers, so they are bounded by the request timeout
    // only; this caller's own cancellation is checked around them.
    const cancelled = () => {
      if (signal?.aborted) throw new FundamentalsError("TIMEOUT", "Company lookup was cancelled.");
    };
    cancelled();
    const entry = (await this.#tickers()).get(toSecTicker(ref.symbol));
    cancelled();
    if (!entry) return null;
    const subs = await this.#submissions(entry.cik);
    cancelled();
    if (!subs) return null;

    const fetchedAt = new Date(this.#now()).toISOString();
    const identity: CompanyIdentity = {
      source: SEC_EDGAR_SOURCE,
      identifiers: { cik: padCik(subs.cik) },
      name: subs.name,
      tickers: subs.tickers,
      exchanges: subs.exchanges.filter((e): e is string => typeof e === "string"),
      entityType: subs.entityType ?? null,
      sic: subs.sic || null,
      sicDescription: subs.sicDescription || null,
      fiscalYearEnd: fiscalYearEnd(subs.fiscalYearEnd),
      stateOfIncorporation: subs.stateOfIncorporation || null,
      formerNames: subs.formerNames.map((f) => ({ name: f.name, from: f.from ?? null, to: f.to ?? null })),
      fetchedAt,
    };
    return {
      identity,
      filings: this.#filings(entry.cik, subs),
      listedExchange: entry.exchange,
      exchangeMatches: entry.exchange !== null && EXCHANGE_TO_MARKET[entry.exchange] === ref.market,
    };
  }

  /**
   * Raw XBRL CompanyFacts for a CIK, or null when SEC has none (404). Uses the same User-Agent,
   * throttle, refusal pause and timeout as every other SEC request. Not cached here (the file is
   * several MB); callers cache their normalised result.
   */
  async fetchCompanyFacts(cik: string | number, { signal }: { signal?: AbortSignal } = {}): Promise<unknown | null> {
    if (!this.#userAgent) {
      throw new FundamentalsError("NOT_CONFIGURED", 'SEC_USER_AGENT is not set or invalid. Use "<app name> <your contact email>".');
    }
    if (signal?.aborted) throw new FundamentalsError("TIMEOUT", "Request was cancelled.");
    return this.#getJson(`${XBRL_URL}/companyfacts/CIK${padCik(cik)}.json`);
  }

  #filings(cik: number, subs: SecSubmissions): CompanyFilings {
    const r = subs.filings.recent;
    const filings: FilingSummary[] = [];
    let coveredFrom: string | null = null;
    let coveredTo: string | null = null;
    for (let i = 0; i < r.accessionNumber.length; i++) {
      const date = r.filingDate[i];
      if (!coveredFrom || date < coveredFrom) coveredFrom = date;
      if (!coveredTo || date > coveredTo) coveredTo = date;
      const kind = classifyFilingForm(r.form[i]);
      if (!kind) continue;
      const accession = r.accessionNumber[i];
      const primary = r.primaryDocument[i] || null;
      filings.push({
        form: r.form[i],
        category: kind.category,
        isAmendment: kind.isAmendment,
        accessionNumber: accession,
        filingDate: date,
        reportDate: r.reportDate[i] || null,
        primaryDocument: primary,
        isXbrl: r.isXBRL[i] === 1,
        isInlineXbrl: r.isInlineXBRL[i] === 1,
        indexUrl: `${ARCHIVES_URL}/${cik}/${accession}-index.html`,
        documentUrl: primary ? docUrl(cik, accession, primary) : null,
      });
    }
    filings.sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0));
    return { filings, coveredFrom, coveredTo, olderFilingsNotLoaded: subs.filings.files.length > 0 };
  }

  // ── Ticker map (cached 24 h, one download shared by concurrent callers) ──

  async #tickers(): Promise<Map<string, TickerEntry>> {
    if (tickerCache && tickerCache.expiresAt > this.#now()) return tickerCache.byTicker;
    if (!tickerInflight) {
      tickerInflight = (async () => {
        try {
          const body = await this.#getJson(TICKERS_URL);
          if (body === null) throw new FundamentalsError("INVALID_RESPONSE", "SEC ticker file was not found.");
          const byTicker = this.#parseTickers(body);
          tickerCache = { expiresAt: this.#now() + this.#tickersTtlMs, byTicker };
          return byTicker;
        } finally {
          tickerInflight = null;
        }
      })();
    }
    return tickerInflight;
  }

  #parseTickers(body: unknown): Map<string, TickerEntry> {
    const parsed = tickersSchema.safeParse(body);
    if (!parsed.success) throw new FundamentalsError("INVALID_RESPONSE", "SEC ticker file had an unexpected format.");
    const col = (name: string) => parsed.data.fields.indexOf(name);
    const [ci, ni, ti, ei] = [col("cik"), col("name"), col("ticker"), col("exchange")];
    if (ci < 0 || ni < 0 || ti < 0 || ei < 0) throw new FundamentalsError("INVALID_RESPONSE", "SEC ticker file is missing expected columns.");
    const map = new Map<string, TickerEntry>();
    for (const row of parsed.data.data) {
      const [cik, name, ticker, exchange] = [row[ci], row[ni], row[ti], row[ei]];
      if (typeof cik !== "number" || typeof ticker !== "string" || typeof name !== "string") continue;
      const key = ticker.toUpperCase();
      if (!map.has(key)) map.set(key, { cik, name, ticker, exchange: typeof exchange === "string" ? exchange : null });
    }
    return map;
  }

  // ── Submissions (cached 1 h per company, bounded) ──

  async #submissions(cik: number): Promise<SecSubmissions | null> {
    const hit = submissionsCache.get(cik);
    if (hit && hit.expiresAt > this.#now()) return hit.value;
    let pending = submissionsInflight.get(cik);
    if (!pending) {
      pending = (async () => {
        try {
          const body = await this.#getJson(`${SUBMISSIONS_URL}/CIK${padCik(cik)}.json`);
          const value = body === null ? null : this.#parseSubmissions(body);
          submissionsCache.delete(cik);
          submissionsCache.set(cik, { expiresAt: this.#now() + this.#submissionsTtlMs, value });
          while (submissionsCache.size > this.#maxCached) submissionsCache.delete(submissionsCache.keys().next().value as number);
          return value;
        } finally {
          submissionsInflight.delete(cik);
        }
      })();
      submissionsInflight.set(cik, pending);
    }
    return pending;
  }

  #parseSubmissions(body: unknown): SecSubmissions {
    const parsed = submissionsSchema.safeParse(body);
    if (!parsed.success) throw new FundamentalsError("INVALID_RESPONSE", "SEC company data had an unexpected format.");
    const lengths = new Set(Object.values(parsed.data.filings.recent).map((a) => a.length));
    if (lengths.size > 1) throw new FundamentalsError("INVALID_RESPONSE", "SEC filing lists were misaligned.");
    return parsed.data;
  }

  // ── HTTP with fair-access throttle, cooldown and timeout ──

  async #getJson(url: string): Promise<unknown | null> {
    const now = this.#now();
    if (now < cooldownUntil) {
      throw new FundamentalsError("RATE_LIMITED", `Pausing SEC requests after a refusal. Try again in ${Math.ceil((cooldownUntil - now) / 1000)}s.`);
    }
    // Reserve the next request slot before awaiting, so concurrent callers queue up.
    const slot = Math.max(now, nextRequestAt);
    nextRequestAt = slot + this.#minIntervalMs;
    if (slot > now) await this.#sleep(slot - now);

    const timeout = AbortSignal.timeout(this.#timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: "GET",
        headers: { "User-Agent": this.#userAgent as string, Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
        signal: timeout,
      });
    } catch (err) {
      if (timeout.aborted || (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))) {
        throw new FundamentalsError("TIMEOUT", `SEC did not respond within ${Math.round(this.#timeoutMs / 1000)}s.`);
      }
      throw new FundamentalsError("PROVIDER_ERROR", "Network error contacting SEC.");
    }

    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) : 60;
      cooldownUntil = this.#now() + seconds * 1000;
      throw res.status === 403
        ? new FundamentalsError(
            "FORBIDDEN",
            `SEC refused the request (403). SEC blocks clients without a declared User-Agent or above 10 requests/second; check SEC_USER_AGENT. Pausing SEC requests for ${seconds}s.`,
          )
        : new FundamentalsError("RATE_LIMITED", `SEC rate limit reached (429). Try again in ${seconds}s.`);
    }
    if (!res.ok) {
      throw new FundamentalsError(
        "PROVIDER_ERROR",
        res.status >= 500 ? `SEC is temporarily unavailable (${res.status}).` : `SEC request failed (${res.status}).`,
      );
    }
    try {
      return JSON.parse(await res.text());
    } catch {
      throw new FundamentalsError("INVALID_RESPONSE", "SEC returned a response that was not valid JSON.");
    }
  }
}
