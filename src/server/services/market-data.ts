import "server-only";
import { db } from "@/server/db";
import { conflict } from "@/server/http";
import { createProviders, PROVIDER_IDS } from "@/server/market-data/registry";
import { syncDailyBars, type SyncOptions, type SyncReport } from "@/server/market-data/sync";
import type { ProviderStatus } from "@/lib/market-data/types";
import { getDataCoverage, type DataCoverage } from "./sources";

export interface SyncLogDTO {
  id: string;
  provider: string;
  symbol: string | null;
  status: string;
  source: string | null;
  fromDate: string;
  toDate: string;
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  message: string | null;
  finishedAt: string;
}

export interface MarketDataStatusDTO {
  providers: (ProviderStatus & { mappedInstruments: number; lastSyncAt: string | null })[];
  coverage: DataCoverage;
  recentSyncs: SyncLogDTO[];
  syncInProgress: boolean;
}

let running = false;

export async function getMarketDataStatus(): Promise<MarketDataStatusDTO> {
  const providers = createProviders();
  const [mappingCounts, lastSyncs, recent, coverage] = await Promise.all([
    db.instrumentProviderSymbol.groupBy({ by: ["provider"], _count: { _all: true } }),
    db.marketDataSync.groupBy({ by: ["provider"], _max: { finishedAt: true } }),
    db.marketDataSync.findMany({
      orderBy: { finishedAt: "desc" },
      take: 40,
      include: { instrument: { select: { symbol: true } } },
    }),
    getDataCoverage(),
  ]);
  const mapped = new Map(mappingCounts.map((m) => [m.provider, m._count._all]));
  const last = new Map(lastSyncs.map((s) => [s.provider, s._max.finishedAt?.toISOString() ?? null]));

  return {
    providers: PROVIDER_IDS.map((id) => ({
      ...providers[id].status(),
      mappedInstruments: mapped.get(id) ?? 0,
      lastSyncAt: last.get(id) ?? null,
    })),
    coverage,
    recentSyncs: recent.map((r) => ({
      id: r.id,
      provider: r.provider,
      symbol: r.instrument?.symbol ?? null,
      status: r.status,
      source: r.source,
      fromDate: r.fromDate,
      toDate: r.toDate,
      received: r.received,
      inserted: r.inserted,
      updated: r.updated,
      unchanged: r.unchanged,
      rejected: r.rejected,
      message: r.message,
      finishedAt: r.finishedAt.toISOString(),
    })),
    syncInProgress: running,
  };
}

/** Runs a sync with credentials from server env. Only one sync runs at a time per server. */
export async function runMarketDataSync(options: Pick<SyncOptions, "providers" | "symbols" | "lookbackDays">): Promise<SyncReport> {
  if (running) throw conflict("A market-data sync is already running");
  running = true;
  try {
    return await syncDailyBars(db, createProviders(), options);
  } finally {
    running = false;
  }
}
