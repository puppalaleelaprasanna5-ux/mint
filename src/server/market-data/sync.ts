/**
 * Daily-bar sync: provider → validation → PriceBar upsert → MarketDataSync audit row.
 *
 * - Only completed sessions are requested (as of `now` minus a safety delay, which also respects
 *   providers that withhold the most recent 15 minutes on free plans).
 * - Bars are keyed by (instrument, interval, source, timestamp), so simulated fallback bars are
 *   never overwritten or mixed: readers choose one source per instrument.
 * - Authorization, permission and rate-limit errors stop further calls to that provider for the
 *   run. Nothing is retried around a refusal.
 *
 * Takes the Prisma client as a parameter so it can run from Next.js route handlers and the CLI.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { ProviderError, type MarketDataProvider, type ProviderId } from "@/lib/market-data/types";
import { validateDailyBars } from "@/lib/market-data/validate";
import { addDays, lastCompletedSessionDate, weekdaysBetween, zonedLocalToUtc } from "@/lib/time";

export interface SyncOptions {
  providers?: ProviderId[];
  /** Mint symbols to limit the run to, e.g. ["RELIANCE", "AAPL"]. */
  symbols?: string[];
  /** Calendar days of history to request when `fromDate` is not given. Default 730 (~2 years). */
  lookbackDays?: number;
  fromDate?: string;
  now?: Date;
  /** Pause between provider requests, to stay well inside rate limits. Default 300 ms. */
  requestDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type SyncItemStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";

export interface SyncItemResult {
  provider: ProviderId;
  symbol: string;
  market: string;
  status: SyncItemStatus;
  source: string | null;
  fromDate: string;
  toDate: string;
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  message: string | null;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  providers: { id: ProviderId; configured: boolean; missingEnv: string[]; ran: boolean }[];
  items: SyncItemResult[];
}

/** Delay before a session's data counts as available (covers 15-minute provider delays). */
const AVAILABILITY_DELAY_MS = 20 * 60 * 1000;

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function summarize(parts: (string | null | undefined)[]): string | null {
  const text = parts.filter(Boolean).join(" | ");
  return text ? text.slice(0, 1000) : null;
}

export async function syncDailyBars(
  db: PrismaClient,
  providers: Record<ProviderId, MarketDataProvider>,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const now = options.now ?? new Date();
  const sleep = options.sleep ?? sleepDefault;
  const delay = options.requestDelayMs ?? 300;
  const lookback = options.lookbackDays ?? 730;
  const wanted = options.providers ?? (Object.keys(providers) as ProviderId[]);
  const symbolFilter = options.symbols?.length ? new Set(options.symbols.map((s) => s.toUpperCase())) : null;
  const availableAt = new Date(now.getTime() - AVAILABILITY_DELAY_MS);

  const report: SyncReport = { startedAt: now.toISOString(), finishedAt: "", providers: [], items: [] };

  for (const id of wanted) {
    const provider = providers[id];
    const status = provider.status();
    report.providers.push({ id, configured: status.configured, missingEnv: status.missingEnv, ran: status.configured });
    if (!status.configured) continue;

    const mappings = await db.instrumentProviderSymbol.findMany({
      where: { provider: id, instrument: { isActive: true } },
      include: { instrument: { include: { market: true } } },
      orderBy: { instrument: { symbol: "asc" } },
    });
    const targets = mappings.filter((m) => !symbolFilter || symbolFilter.has(m.instrument.symbol));

    let stopReason: string | null = null;
    for (let i = 0; i < targets.length; i++) {
      const { instrument } = targets[i];
      const market = instrument.market;
      const toDate = lastCompletedSessionDate(market, availableAt);
      const fromDate = options.fromDate ?? addDays(toDate, -lookback);
      const ref = {
        providerSymbol: targets[i].providerSymbol,
        symbol: instrument.symbol,
        type: instrument.type,
        currency: instrument.currency,
      };
      const base = {
        provider: id,
        symbol: instrument.symbol,
        market: market.code,
        fromDate,
        toDate,
        received: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        rejected: 0,
      };
      const startedAt = new Date();

      let result: SyncItemResult;
      if (stopReason) {
        result = { ...base, status: "SKIPPED", source: null, message: `Skipped: ${stopReason}` };
      } else if (!provider.supports(ref)) {
        result = { ...base, status: "SKIPPED", source: null, message: `${provider.name} does not provide ${instrument.type.toLowerCase()} data for ${instrument.symbol}` };
      } else if (fromDate > toDate) {
        result = { ...base, status: "SKIPPED", source: null, message: "Empty date range" };
      } else {
        try {
          if (i > 0 && delay > 0) await sleep(delay);
          const fetched = await provider.fetchDailyBars({
            instrument: ref,
            market: { code: market.code, timezone: market.timezone, currency: market.currency },
            fromDate,
            toDate,
            notAfter: availableAt,
          });
          const validation = validateDailyBars(fetched.bars, {
            expectedCurrency: instrument.currency,
            providerCurrency: fetched.currency,
            lastCompletedDate: toDate,
            allowZeroVolume: instrument.type === "INDEX",
          });
          const received = fetched.bars.length + fetched.unparseable;
          const rejected = validation.rejected.length + fetched.unparseable;

          let inserted = 0;
          let updated = 0;
          let unchanged = 0;
          if (!validation.batchError && validation.valid.length) {
            ({ inserted, updated, unchanged } = await writeBars(db, {
              instrumentId: instrument.id,
              source: fetched.source,
              openTime: market.openTime,
              timezone: market.timezone,
              fetchedAt: now,
              bars: validation.valid,
            }));
          }

          const rejectionSample = validation.rejected
            .slice(0, 3)
            .map((r) => `${r.tradingDate}: ${r.reasons.join(", ")}`)
            .join("; ");
          // A range that spans several weekdays but returns nothing is a failure, not a success.
          const expectedSessions = weekdaysBetween(fromDate, toDate).length;
          const emptyButExpected = received === 0 && expectedSessions >= 5;
          const status: SyncItemStatus = validation.batchError || emptyButExpected
            ? "FAILED"
            : rejected > 0
              ? validation.valid.length > 0
                ? "PARTIAL"
                : "FAILED"
              : "SUCCESS";
          result = {
            ...base,
            status,
            source: fetched.source,
            received,
            inserted,
            updated,
            unchanged,
            rejected,
            message: summarize([
              validation.batchError,
              received === 0 ? `Provider returned no bars for this range (${expectedSessions} weekdays requested)` : null,
              fetched.unparseable ? `${fetched.unparseable} unparseable rows` : null,
              rejectionSample ? `Rejected ${validation.rejected.length}: ${rejectionSample}` : null,
              validation.warnings.length ? `Warnings: ${validation.warnings.slice(0, 3).join("; ")}` : null,
              ...fetched.notes,
            ]),
          };
        } catch (err) {
          if (err instanceof ProviderError) {
            if (err.stopsRun) stopReason = `${provider.name} ${err.kind.toLowerCase().replace("_", " ")} — ${err.message}`;
            result = { ...base, status: "FAILED", source: null, message: `${err.kind}: ${err.message}` };
          } else {
            result = { ...base, status: "FAILED", source: null, message: "Unexpected error while syncing (see server log)" };
            console.error("[market-data] unexpected sync error", err);
          }
        }
      }

      await db.marketDataSync.create({
        data: {
          provider: id,
          instrumentId: instrument.id,
          interval: "ONE_DAY",
          source: result.source,
          fromDate,
          toDate,
          status: result.status,
          received: result.received,
          inserted: result.inserted,
          updated: result.updated,
          unchanged: result.unchanged,
          rejected: result.rejected,
          message: result.message,
          startedAt,
          finishedAt: new Date(),
        },
      });
      report.items.push(result);
    }
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

interface WriteInput {
  instrumentId: string;
  source: string;
  openTime: string;
  timezone: string;
  fetchedAt: Date;
  bars: { tradingDate: string; open: number; high: number; low: number; close: number; volume: number }[];
}

/** Insert new bars, update changed ones, leave identical ones untouched. One transaction. */
export async function writeBars(db: PrismaClient, input: WriteInput) {
  const first = input.bars[0].tradingDate;
  const last = input.bars[input.bars.length - 1].tradingDate;
  const existing = await db.priceBar.findMany({
    where: {
      instrumentId: input.instrumentId,
      interval: "ONE_DAY",
      source: input.source,
      tradingDate: { gte: first, lte: last },
    },
  });
  const byDate = new Map(existing.map((b) => [b.tradingDate, b]));

  const toCreate = [];
  const toUpdate = [];
  let unchanged = 0;
  for (const bar of input.bars) {
    const timestamp = zonedLocalToUtc(bar.tradingDate, input.openTime, input.timezone);
    const prev = byDate.get(bar.tradingDate);
    if (!prev) {
      toCreate.push({
        instrumentId: input.instrumentId,
        interval: "ONE_DAY" as const,
        timestamp,
        tradingDate: bar.tradingDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        source: input.source,
        isSimulated: false,
        fetchedAt: input.fetchedAt,
      });
    } else if (
      prev.open !== bar.open ||
      prev.high !== bar.high ||
      prev.low !== bar.low ||
      prev.close !== bar.close ||
      prev.volume !== bar.volume
    ) {
      toUpdate.push({ id: prev.id, bar });
    } else {
      unchanged++;
    }
  }

  await db.$transaction([
    ...(toCreate.length ? [db.priceBar.createMany({ data: toCreate })] : []),
    ...toUpdate.map(({ id, bar }) =>
      db.priceBar.update({
        where: { id },
        data: {
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          fetchedAt: input.fetchedAt,
        },
      }),
    ),
  ]);
  return { inserted: toCreate.length, updated: toUpdate.length, unchanged };
}
