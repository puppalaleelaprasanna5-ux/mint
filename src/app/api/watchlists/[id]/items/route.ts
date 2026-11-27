import { ok, readJson, route } from "@/server/http";
import { addWatchlistItem } from "@/server/services/watchlists";
import { addWatchlistItemSchema } from "@/lib/validation";

/** POST /api/watchlists/:id/items { instrumentId, note? } — add an instrument. */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { instrumentId, note } = addWatchlistItemSchema.parse(await readJson(request));
  return ok(await addWatchlistItem(id, instrumentId, note), { status: 201 });
});
