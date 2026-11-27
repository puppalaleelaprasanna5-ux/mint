import "server-only";
import { db } from "@/server/db";
import { getSessionStatus } from "@/lib/time";
import type { MarketFilter } from "@/lib/validation";
import type { MarketDTO, RegionCode, RegionOverviewDTO } from "@/lib/types";
import { toInstrumentSummary, toMarketDTO, toQuote } from "./mappers";
import { resolveBarSource } from "./sources";
import { getDailyBars } from "./prices";

const REGION_LABELS: Record<RegionCode, string> = { IN: "India", US: "United States" };

/** Benchmark indices shown on the dashboard, in display order. */
const BENCHMARKS: Record<RegionCode, { market: string; symbol: string }[]> = {
  IN: [
    { market: "NSE", symbol: "NIFTY50" },
    { market: "BSE", symbol: "SENSEX" },
  ],
  US: [
    { market: "NASDAQ", symbol: "IXIC" },
    { market: "NYSE", symbol: "SPX" },
  ],
};

export async function listMarkets(): Promise<MarketDTO[]> {
  const rows = await db.market.findMany({ orderBy: [{ region: "asc" }, { code: "asc" }] });
  return rows.map(toMarketDTO);
}

export function regionsFor(filter: MarketFilter): RegionCode[] {
  return filter === "ALL" ? ["IN", "US"] : [filter];
}

/**
 * Overview per region: exchange session status (wall clock) and benchmark index snapshots with
 * a closing-price history (`historyDays` bars) for sparklines / performance charts.
 */
export async function getRegionOverviews(
  filter: MarketFilter,
  { historyDays = 260, now = new Date() }: { historyDays?: number; now?: Date } = {},
): Promise<RegionOverviewDTO[]> {
  const regions = regionsFor(filter);
  return Promise.all(
    regions.map(async (region) => {
      const markets = await db.market.findMany({ where: { region }, orderBy: { code: "asc" } });
      const indices = await Promise.all(
        BENCHMARKS[region].map(async ({ market, symbol }) => {
          const instrument = await db.instrument.findFirst({
            where: { symbol, market: { code: market } },
            include: { market: true },
          });
          if (!instrument) return null;
          const bars = await db.priceBar.findMany({
            where: { instrumentId: instrument.id, interval: "ONE_DAY", ...(await resolveBarSource(instrument.id)) },
            orderBy: { timestamp: "desc" },
            take: historyDays,
          });
          bars.reverse();
          return {
            ...toInstrumentSummary(instrument),
            quote: toQuote(bars.slice(-2)),
            sparkline: bars.map((b) => ({ time: b.tradingDate, close: b.close })),
          };
        }),
      );
      return {
        region,
        label: REGION_LABELS[region],
        markets: markets.map((m) => ({ ...toMarketDTO(m), session: getSessionStatus(m, now) })),
        indices: indices.filter((x): x is NonNullable<typeof x> => x !== null),
      };
    }),
  );
}

/**
 * Primary benchmark index for a region (NIFTY 50 for India, S&P 500 for the US) with its daily
 * bars, for beta calculations. `isSimulated` lets the risk engine refuse simulated benchmarks.
 */
export async function getBenchmark(region: RegionCode) {
  const { market, symbol } = region === "IN" ? BENCHMARKS.IN[0] : BENCHMARKS.US[1];
  const instrument = await db.instrument.findFirst({ where: { symbol, market: { code: market } } });
  if (!instrument) return null;
  const history = await getDailyBars(instrument.id, { limit: 5000 });
  return {
    instrumentId: instrument.id,
    name: instrument.name,
    bars: history.bars,
    isSimulated: history.provenance?.isSimulated ?? true,
  };
}
