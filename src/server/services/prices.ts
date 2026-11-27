import "server-only";
import { db } from "@/server/db";
import { notFound } from "@/server/http";
import type { BarsResponseDTO } from "@/lib/types";
import { toBarDTO, toInstrumentSummary, toProvenance } from "./mappers";
import { resolveBarSource } from "./sources";

export interface BarsQuery {
  from?: string; // exchange-local trading date, inclusive
  to?: string; // exchange-local trading date, inclusive
  limit: number; // most recent N bars within the range
}

/** Daily bars for an instrument, oldest → newest. */
export async function getDailyBars(instrumentId: string, query: BarsQuery): Promise<BarsResponseDTO> {
  const instrument = await db.instrument.findUnique({ where: { id: instrumentId }, include: { market: true } });
  if (!instrument) throw notFound("Instrument");

  const sourceFilter = await resolveBarSource(instrumentId);
  const rows = await db.priceBar.findMany({
    where: {
      instrumentId,
      interval: "ONE_DAY",
      ...sourceFilter,
      ...(query.from || query.to
        ? { tradingDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    },
    orderBy: { timestamp: "desc" },
    take: query.limit,
  });
  rows.reverse();

  return {
    instrument: toInstrumentSummary(instrument),
    interval: "ONE_DAY",
    bars: rows.map(toBarDTO),
    provenance: rows.length ? toProvenance(rows[rows.length - 1]) : null,
  };
}
