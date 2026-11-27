import { ok, route } from "@/server/http";
import { removeWatchlistItem } from "@/server/services/watchlists";

/** DELETE /api/watchlists/:id/items/:instrumentId — remove an instrument from the watchlist. */
export const DELETE = route(
  async (_request: Request, ctx: { params: Promise<{ id: string; instrumentId: string }> }) => {
    const { id, instrumentId } = await ctx.params;
    await removeWatchlistItem(id, instrumentId);
    return ok({ deleted: true });
  },
);
