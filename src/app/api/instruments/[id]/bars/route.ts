import type { NextRequest } from "next/server";
import { ok, route } from "@/server/http";
import { getDailyBars } from "@/server/services/prices";
import { barsQuerySchema, searchParamsToObject } from "@/lib/validation";

/** GET /api/instruments/:id/bars?interval=1d&from=YYYY-MM-DD&to=YYYY-MM-DD&limit= — OHLCV history. */
export const GET = route(async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const query = barsQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  return ok(await getDailyBars(id, query));
});
