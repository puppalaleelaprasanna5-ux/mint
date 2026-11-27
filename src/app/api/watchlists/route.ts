import { ok, readJson, route } from "@/server/http";
import { createWatchlist, listWatchlists } from "@/server/services/watchlists";
import { createWatchlistSchema } from "@/lib/validation";

/** GET /api/watchlists — all watchlists with item counts. */
export const GET = route(async () => ok(await listWatchlists()));

/** POST /api/watchlists { name } — create a watchlist. */
export const POST = route(async (request: Request) => {
  const { name } = createWatchlistSchema.parse(await readJson(request));
  return ok(await createWatchlist(name), { status: 201 });
});
