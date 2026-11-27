import { ok, route } from "@/server/http";
import { getMarketDataStatus } from "@/server/services/market-data";

/** GET /api/market-data/status — provider configuration (env var names only, never values), coverage, sync log. */
export const GET = route(async () => ok(await getMarketDataStatus()));
