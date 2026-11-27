import "server-only";
import type { Instrument, Market, PriceBar } from "@/generated/prisma/client";
import { computeChange } from "@/lib/quotes";
import type {
  BarDTO,
  DataProvenance,
  InstrumentSummaryDTO,
  MarketDTO,
  QuoteDTO,
} from "@/lib/types";

export type InstrumentWithMarket = Instrument & { market: Market };

export function toMarketDTO(m: Market): MarketDTO {
  return {
    id: m.id,
    code: m.code,
    mic: m.mic,
    name: m.name,
    region: m.region,
    timezone: m.timezone,
    currency: m.currency,
    openTime: m.openTime,
    closeTime: m.closeTime,
  };
}

export function toInstrumentSummary(i: InstrumentWithMarket): InstrumentSummaryDTO {
  return {
    id: i.id,
    symbol: i.symbol,
    name: i.name,
    type: i.type,
    currency: i.currency,
    sector: i.sector,
    market: { code: i.market.code, region: i.market.region, timezone: i.market.timezone },
  };
}

export function toProvenance(bar: PriceBar): DataProvenance {
  return {
    source: bar.source,
    isSimulated: bar.isSimulated,
    asOfTradingDate: bar.tradingDate,
    fetchedAt: bar.fetchedAt.toISOString(),
  };
}

/** `bars` ordered oldest → newest. */
export function toQuote(bars: PriceBar[]): QuoteDTO | null {
  const change = computeChange(bars);
  if (!change) return null;
  const latest = bars[bars.length - 1];
  return {
    last: change.last,
    previousClose: change.previous,
    change: change.change,
    changePercent: change.changePercent,
    volume: latest.volume,
    provenance: toProvenance(latest),
  };
}

export function toBarDTO(b: PriceBar): BarDTO {
  return {
    time: b.tradingDate,
    timestamp: b.timestamp.toISOString(),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  };
}
