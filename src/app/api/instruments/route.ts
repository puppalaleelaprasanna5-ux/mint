import type { NextRequest } from "next/server";
import { ok, route } from "@/server/http";
import { searchInstruments } from "@/server/services/instruments";
import { instrumentSearchQuerySchema, searchParamsToObject } from "@/lib/validation";

/** GET /api/instruments?q=&region=IN|US&type=EQUITY|INDEX|ETF&limit= — search with latest quotes. */
export const GET = route(async (request: NextRequest) => {
  const query = instrumentSearchQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  return ok(await searchInstruments(query));
});
