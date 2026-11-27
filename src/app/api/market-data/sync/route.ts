import { badRequest, ok, route } from "@/server/http";
import { runMarketDataSync } from "@/server/services/market-data";
import { marketDataSyncSchema } from "@/lib/validation";

/**
 * POST /api/market-data/sync { providers?: ["upstox","alpaca"], symbols?: string[], lookbackDays?: number }
 * Fetches daily history from configured providers. An empty body syncs everything that is mapped.
 * Unconfigured providers are reported in the response, never called.
 */
export const POST = route(async (request: Request) => {
  const text = (await request.text()).trim();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw badRequest("Request body must be valid JSON");
    }
  }
  return ok(await runMarketDataSync(marketDataSyncSchema.parse(body)));
});
