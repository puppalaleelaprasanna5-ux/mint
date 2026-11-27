import "server-only";
import { db } from "@/server/db";
import { notFound } from "@/server/http";
import { rankBySearch } from "@/lib/search";
import type { Prisma } from "@/generated/prisma/client";
import type { InstrumentTypeCode, InstrumentWithQuoteDTO, QuoteDTO, RegionCode } from "@/lib/types";
import { toInstrumentSummary, toQuote } from "./mappers";
import { resolveBarSources } from "./sources";

/** Latest quote (last two daily bars) for each instrument id. */
export async function getQuotes(instrumentIds: string[]): Promise<Map<string, QuoteDTO | null>> {
  const unique = [...new Set(instrumentIds)];
  const sources = await resolveBarSources(unique);
  const entries = await Promise.all(
    unique.map(async (id) => {
      const bars = await db.priceBar.findMany({
        where: { instrumentId: id, interval: "ONE_DAY", ...sources.get(id) },
        orderBy: { timestamp: "desc" },
        take: 2,
      });
      return [id, toQuote(bars.reverse())] as const;
    }),
  );
  return new Map(entries);
}

export interface SearchParams {
  q: string;
  region?: RegionCode;
  type?: InstrumentTypeCode;
  limit: number;
}

export async function searchInstruments(params: SearchParams): Promise<InstrumentWithQuoteDTO[]> {
  const q = params.q.trim();
  const where: Prisma.InstrumentWhereInput = {
    isActive: true,
    ...(params.type ? { type: params.type } : {}),
    ...(params.region ? { market: { region: params.region } } : {}),
    // SQLite LIKE is case-insensitive for ASCII, so `contains` gives case-insensitive search.
    ...(q ? { OR: [{ symbol: { contains: q } }, { name: { contains: q } }] } : {}),
  };
  const rows = await db.instrument.findMany({
    where,
    include: { market: true },
    orderBy: [{ type: "desc" }, { symbol: "asc" }], // INDEX before EQUITY when browsing
    take: 200,
  });
  const ranked = (q ? rankBySearch(rows, q) : rows).slice(0, params.limit);
  const quotes = await getQuotes(ranked.map((r) => r.id));
  return ranked.map((r) => ({ ...toInstrumentSummary(r), quote: quotes.get(r.id) ?? null }));
}

export async function getInstrumentWithQuote(id: string): Promise<InstrumentWithQuoteDTO> {
  const row = await db.instrument.findUnique({ where: { id }, include: { market: true } });
  if (!row) throw notFound("Instrument");
  const quotes = await getQuotes([id]);
  return { ...toInstrumentSummary(row), quote: quotes.get(id) ?? null };
}

export async function getInstrumentDetail(id: string) {
  const row = await db.instrument.findUnique({ where: { id }, include: { market: true } });
  if (!row) throw notFound("Instrument");
  return row;
}
