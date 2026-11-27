import "server-only";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Chooses ONE bar source per instrument so a series never mixes simulated and real data:
 * the provider source with the most recent fetch if any provider bars exist, otherwise the
 * simulated fallback.
 */
export async function resolveBarSources(instrumentIds: string[]): Promise<Map<string, Prisma.PriceBarWhereInput>> {
  const ids = [...new Set(instrumentIds)];
  const result = new Map<string, Prisma.PriceBarWhereInput>();
  if (ids.length === 0) return result;

  const real = await db.priceBar.groupBy({
    by: ["instrumentId", "source"],
    where: { instrumentId: { in: ids }, interval: "ONE_DAY", isSimulated: false },
    _max: { fetchedAt: true },
  });
  const best = new Map<string, { source: string; fetchedAt: number }>();
  for (const row of real) {
    const t = row._max.fetchedAt?.getTime() ?? 0;
    const current = best.get(row.instrumentId);
    if (!current || t > current.fetchedAt) best.set(row.instrumentId, { source: row.source, fetchedAt: t });
  }
  for (const id of ids) {
    const chosen = best.get(id);
    result.set(id, chosen ? { source: chosen.source, isSimulated: false } : { isSimulated: true });
  }
  return result;
}

export async function resolveBarSource(instrumentId: string): Promise<Prisma.PriceBarWhereInput> {
  return (await resolveBarSources([instrumentId])).get(instrumentId) ?? { isSimulated: true };
}

export interface DataCoverage {
  instrumentsWithData: number;
  providerBacked: number;
  simulatedOnly: number;
  providerSources: string[];
}

/** How many instruments are served from provider data vs the simulated fallback. */
export async function getDataCoverage(): Promise<DataCoverage> {
  const rows = await db.priceBar.groupBy({
    by: ["instrumentId", "source", "isSimulated"],
    where: { interval: "ONE_DAY" },
  });
  const real = new Set<string>();
  const all = new Set<string>();
  const sources = new Set<string>();
  for (const r of rows) {
    all.add(r.instrumentId);
    if (!r.isSimulated) {
      real.add(r.instrumentId);
      sources.add(r.source);
    }
  }
  return {
    instrumentsWithData: all.size,
    providerBacked: real.size,
    simulatedOnly: all.size - real.size,
    providerSources: [...sources].sort(),
  };
}
