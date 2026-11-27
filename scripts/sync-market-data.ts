/**
 * Sync daily historical bars from configured providers.
 *
 *   npm run data:sync                                  # all configured providers, ~2 years
 *   npm run data:sync -- --provider=upstox             # one provider
 *   npm run data:sync -- --symbols=RELIANCE,AAPL       # specific instruments
 *   npm run data:sync -- --days=365                    # lookback in calendar days
 *
 * Credentials come from .env (see .env.example). Exit code 1 if any instrument failed.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/server/prisma-factory";
import { createProviders } from "../src/server/market-data/registry";
import { syncDailyBars } from "../src/server/market-data/sync";
import { marketDataSyncSchema } from "../src/lib/validation";

function parseArgs(argv: string[]) {
  const raw: Record<string, unknown> = {};
  for (const arg of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(arg);
    if (!m) throw new Error(`Unrecognised argument "${arg}". Use --provider=, --symbols=, --days=`);
    const [, key, value] = m;
    if (key === "provider") raw.providers = value.split(",").filter(Boolean);
    else if (key === "symbols") raw.symbols = value.split(",").filter(Boolean);
    else if (key === "days") raw.lookbackDays = value;
    else throw new Error(`Unknown option --${key}`);
  }
  return marketDataSyncSchema.parse(raw);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = createPrismaClient();
  try {
    const report = await syncDailyBars(db, createProviders(), options);
    for (const p of report.providers) {
      console.log(
        p.configured
          ? `${p.id}: configured`
          : `${p.id}: NOT CONFIGURED — set ${p.missingEnv.join(", ") || "a valid configuration"} in .env (skipped)`,
      );
    }
    if (report.items.length) {
      console.table(
        report.items.map((i) => ({
          provider: i.provider,
          symbol: i.symbol,
          status: i.status,
          range: `${i.fromDate}..${i.toDate}`,
          received: i.received,
          inserted: i.inserted,
          updated: i.updated,
          unchanged: i.unchanged,
          rejected: i.rejected,
        })),
      );
      for (const i of report.items.filter((x) => x.message)) console.log(`- ${i.provider} ${i.symbol}: ${i.message}`);
    } else {
      console.log("Nothing synced. Simulated data remains the fallback for every instrument.");
    }
    if (report.items.some((i) => i.status === "FAILED")) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
