import "server-only";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/http";
import type { WatchlistDTO, WatchlistSummaryDTO } from "@/lib/types";
import { getQuotes } from "./instruments";
import { toInstrumentSummary } from "./mappers";

export async function listWatchlists(): Promise<WatchlistSummaryDTO[]> {
  const rows = await db.watchlist.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  return rows.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault, itemCount: w._count.items }));
}

export async function getWatchlist(id: string): Promise<WatchlistDTO> {
  const w = await db.watchlist.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { addedAt: "asc" }],
        include: { instrument: { include: { market: true } } },
      },
    },
  });
  if (!w) throw notFound("Watchlist");
  const quotes = await getQuotes(w.items.map((i) => i.instrumentId));
  return {
    id: w.id,
    name: w.name,
    isDefault: w.isDefault,
    items: w.items.map((item) => ({
      id: item.id,
      note: item.note,
      addedAt: item.addedAt.toISOString(),
      instrument: { ...toInstrumentSummary(item.instrument), quote: quotes.get(item.instrumentId) ?? null },
    })),
  };
}

/** The default watchlist, or the oldest one if none is flagged. Null when there are none. */
export async function getDefaultWatchlistId(): Promise<string | null> {
  const w = await db.watchlist.findFirst({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return w?.id ?? null;
}

export async function createWatchlist(name: string): Promise<WatchlistSummaryDTO> {
  const existing = await db.watchlist.findUnique({ where: { name } });
  if (existing) throw conflict(`A watchlist named "${name}" already exists`);
  const hasAny = (await db.watchlist.count()) > 0;
  const w = await db.watchlist.create({ data: { name, isDefault: !hasAny } });
  return { id: w.id, name: w.name, isDefault: w.isDefault, itemCount: 0 };
}

export async function updateWatchlist(
  id: string,
  patch: { name?: string; isDefault?: true },
): Promise<WatchlistSummaryDTO> {
  const current = await db.watchlist.findUnique({ where: { id } });
  if (!current) throw notFound("Watchlist");
  if (patch.name && patch.name !== current.name) {
    const clash = await db.watchlist.findUnique({ where: { name: patch.name } });
    if (clash) throw conflict(`A watchlist named "${patch.name}" already exists`);
  }
  const w = await db.$transaction(async (tx) => {
    if (patch.isDefault) {
      await tx.watchlist.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
    }
    return tx.watchlist.update({
      where: { id },
      data: { ...(patch.name ? { name: patch.name } : {}), ...(patch.isDefault ? { isDefault: true } : {}) },
      include: { _count: { select: { items: true } } },
    });
  });
  return { id: w.id, name: w.name, isDefault: w.isDefault, itemCount: w._count.items };
}

export async function deleteWatchlist(id: string): Promise<void> {
  const current = await db.watchlist.findUnique({ where: { id } });
  if (!current) throw notFound("Watchlist");
  await db.$transaction(async (tx) => {
    await tx.watchlist.delete({ where: { id } });
    if (current.isDefault) {
      const next = await tx.watchlist.findFirst({ orderBy: { createdAt: "asc" } });
      if (next) await tx.watchlist.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

export async function addWatchlistItem(watchlistId: string, instrumentId: string, note?: string) {
  const [watchlist, instrument] = await Promise.all([
    db.watchlist.findUnique({ where: { id: watchlistId } }),
    db.instrument.findUnique({ where: { id: instrumentId } }),
  ]);
  if (!watchlist) throw notFound("Watchlist");
  if (!instrument) throw notFound("Instrument");
  const existing = await db.watchlistItem.findUnique({
    where: { watchlistId_instrumentId: { watchlistId, instrumentId } },
  });
  if (existing) throw conflict(`${instrument.symbol} is already in "${watchlist.name}"`);
  const max = await db.watchlistItem.aggregate({ where: { watchlistId }, _max: { sortOrder: true } });
  const item = await db.watchlistItem.create({
    data: { watchlistId, instrumentId, note: note || null, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  return { id: item.id, watchlistId, instrumentId };
}

export async function removeWatchlistItem(watchlistId: string, instrumentId: string): Promise<void> {
  const result = await db.watchlistItem.deleteMany({ where: { watchlistId, instrumentId } });
  if (result.count === 0) throw notFound("Watchlist item");
}

/** Watchlists that contain the instrument (for the instrument page's add/remove control). */
export async function watchlistIdsContaining(instrumentId: string): Promise<string[]> {
  const rows = await db.watchlistItem.findMany({ where: { instrumentId }, select: { watchlistId: true } });
  return rows.map((r) => r.watchlistId);
}
