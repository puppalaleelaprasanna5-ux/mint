/**
 * Development seed: reference markets, demo instruments, SIMULATED daily price bars (the fallback
 * data source), provider symbol mappings and a starter watchlist. Safe to re-run: markets,
 * instruments and mappings are upserted, simulated bars are replaced, and provider bars,
 * user-created watchlists, alerts and other data are left untouched.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/server/prisma-factory";
import { DEMO_INSTRUMENTS, DEMO_MARKETS, DEMO_SOURCE, DEMO_TRADING_DAYS, DEMO_WATCHLIST } from "../src/lib/demo/universe";
import { generateBars, generateMarketFactor } from "../src/lib/demo/generate";
import { addDays, isWeekend, lastCompletedSessionDate, zonedLocalToUtc } from "../src/lib/time";
import { PROVIDER_SYMBOLS } from "../src/lib/market-data/provider-symbols";

const db = createPrismaClient();

function lastNWeekdays(endDate: string, n: number): string[] {
  const out: string[] = [];
  for (let d = endDate; out.length < n; d = addDays(d, -1)) {
    if (!isWeekend(d)) out.push(d);
  }
  return out.reverse();
}

async function main() {
  const now = new Date();
  console.log("Seeding Mint development database (SIMULATED market data)…");

  // 1. Markets
  const marketIds = new Map<string, string>();
  const marketByCode = new Map(DEMO_MARKETS.map((m) => [m.code, m]));
  for (const m of DEMO_MARKETS) {
    const row = await db.market.upsert({
      where: { code: m.code },
      create: m,
      update: { ...m },
    });
    marketIds.set(m.code, row.id);
  }
  console.log(`  markets: ${DEMO_MARKETS.length}`);

  // 2. Regional trading-date grids and common market factors
  const regionDates = new Map<string, string[]>();
  const regionFactor = new Map<string, number[]>();
  for (const region of ["IN", "US"] as const) {
    const ref = DEMO_MARKETS.find((m) => m.region === region)!;
    const end = lastCompletedSessionDate(ref, now);
    const dates = lastNWeekdays(end, DEMO_TRADING_DAYS);
    regionDates.set(region, dates);
    regionFactor.set(region, generateMarketFactor(dates, region));
    console.log(`  ${region} simulated sessions: ${dates[0]} → ${end}`);
  }

  // 3. Instruments + simulated bars
  let barCount = 0;
  const instrumentIds = new Map<string, string>();
  for (const spec of DEMO_INSTRUMENTS) {
    const market = marketByCode.get(spec.market);
    const marketId = marketIds.get(spec.market);
    if (!market || !marketId) throw new Error(`Unknown market ${spec.market}`);

    const instrument = await db.instrument.upsert({
      where: { marketId_symbol: { marketId, symbol: spec.symbol } },
      create: {
        marketId,
        symbol: spec.symbol,
        name: spec.name,
        type: spec.type,
        currency: market.currency,
        sector: spec.sector ?? null,
      },
      update: { name: spec.name, type: spec.type, currency: market.currency, sector: spec.sector ?? null },
    });
    instrumentIds.set(`${spec.market}:${spec.symbol}`, instrument.id);

    const dates = regionDates.get(market.region)!;
    const factor = regionFactor.get(market.region)!;
    const bars = generateBars(dates, factor, spec.sim, `${spec.market}:${spec.symbol}`);

    await db.$transaction([
      db.priceBar.deleteMany({ where: { instrumentId: instrument.id, source: DEMO_SOURCE } }),
      db.priceBar.createMany({
        data: bars.map((b) => ({
          instrumentId: instrument.id,
          interval: "ONE_DAY" as const,
          timestamp: zonedLocalToUtc(b.tradingDate, market.openTime, market.timezone),
          tradingDate: b.tradingDate,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
          source: DEMO_SOURCE,
          isSimulated: true,
          fetchedAt: now,
        })),
      }),
    ]);
    barCount += bars.length;
  }
  console.log(`  instruments: ${DEMO_INSTRUMENTS.length}, simulated daily bars: ${barCount}`);

  // 4. Provider symbol mappings (used by `npm run data:sync`)
  for (const m of PROVIDER_SYMBOLS) {
    const instrumentId = instrumentIds.get(`${m.market}:${m.symbol}`);
    if (!instrumentId) throw new Error(`Provider mapping for unknown instrument ${m.market}:${m.symbol}`);
    await db.instrumentProviderSymbol.upsert({
      where: { provider_instrumentId: { provider: m.provider, instrumentId } },
      create: { instrumentId, provider: m.provider, providerSymbol: m.providerSymbol, verifiedFrom: m.verifiedFrom },
      update: { providerSymbol: m.providerSymbol, verifiedFrom: m.verifiedFrom },
    });
  }
  console.log(`  provider symbol mappings: ${PROVIDER_SYMBOLS.length}`);

  // 5. Starter watchlist (only created if it doesn't exist; never overwrites user edits)
  const existing = await db.watchlist.findUnique({ where: { name: DEMO_WATCHLIST.name } });
  if (!existing) {
    const hasDefault = (await db.watchlist.count({ where: { isDefault: true } })) > 0;
    await db.watchlist.create({
      data: {
        name: DEMO_WATCHLIST.name,
        isDefault: !hasDefault,
        items: {
          create: DEMO_WATCHLIST.symbols.map((s, i) => ({
            instrumentId: instrumentIds.get(`${s.market}:${s.symbol}`)!,
            sortOrder: i,
          })),
        },
      },
    });
    console.log(`  watchlist "${DEMO_WATCHLIST.name}" created`);
  } else {
    console.log(`  watchlist "${DEMO_WATCHLIST.name}" already exists, left unchanged`);
  }

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
