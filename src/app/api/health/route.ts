import { db } from "@/server/db";
import { ok, route } from "@/server/http";

/** GET /api/health — database connectivity and data-mode summary. */
export const GET = route(async () => {
  const [markets, instruments, bars, simulatedBars] = await Promise.all([
    db.market.count(),
    db.instrument.count(),
    db.priceBar.count(),
    db.priceBar.count({ where: { isSimulated: true } }),
  ]);
  return ok({
    status: "ok",
    database: "sqlite",
    counts: { markets, instruments, priceBars: bars },
    dataMode: bars === 0 ? "empty" : simulatedBars === bars ? "simulated" : simulatedBars > 0 ? "mixed" : "provider",
    checkedAt: new Date().toISOString(),
  });
});
