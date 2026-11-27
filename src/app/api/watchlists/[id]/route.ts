import { ok, readJson, route } from "@/server/http";
import { deleteWatchlist, getWatchlist, updateWatchlist } from "@/server/services/watchlists";
import { updateWatchlistSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/watchlists/:id — watchlist with items and latest quotes. */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await getWatchlist(id));
});

/** PATCH /api/watchlists/:id { name?, isDefault?: true } — rename or make default. */
export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const patch = updateWatchlistSchema.parse(await readJson(request));
  return ok(await updateWatchlist(id, patch));
});

/** DELETE /api/watchlists/:id */
export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await deleteWatchlist(id);
  return ok({ deleted: true });
});
