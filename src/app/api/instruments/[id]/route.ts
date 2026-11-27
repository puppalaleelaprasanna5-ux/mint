import { ok, route } from "@/server/http";
import { getInstrumentWithQuote } from "@/server/services/instruments";

/** GET /api/instruments/:id — instrument metadata with latest quote. */
export const GET = route(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return ok(await getInstrumentWithQuote(id));
});
