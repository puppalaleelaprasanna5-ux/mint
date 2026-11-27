import type { NextRequest } from "next/server";
import { ok, route } from "@/server/http";
import { getRegionOverviews } from "@/server/services/markets";
import { overviewQuerySchema, searchParamsToObject } from "@/lib/validation";

/** GET /api/overview?region=ALL|IN|US — benchmark index snapshots and session status per region. */
export const GET = route(async (request: NextRequest) => {
  const { region } = overviewQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  return ok(await getRegionOverviews(region, { historyDays: 30 }));
});
