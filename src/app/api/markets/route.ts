import { ok, route } from "@/server/http";
import { listMarkets } from "@/server/services/markets";
import { getSessionStatus } from "@/lib/time";

/** GET /api/markets — exchanges with time zone, currency, hours and current session state. */
export const GET = route(async () => {
  const now = new Date();
  const markets = await listMarkets();
  return ok(markets.map((m) => ({ ...m, session: getSessionStatus(m, now) })));
});
