import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/server/http";
import { createAlert, listAlerts } from "@/server/services/alerts";
import { createAlertSchema } from "@/lib/validation";

/** GET /api/alerts?instrumentId= — alerts with current quotes. */
export const GET = route(async (request: NextRequest) => {
  const instrumentId = request.nextUrl.searchParams.get("instrumentId") || undefined;
  return ok(await listAlerts({ instrumentId }));
});

/** POST /api/alerts { instrumentId, type: PRICE_ABOVE|PRICE_BELOW, threshold, note? } */
export const POST = route(async (request: Request) => {
  const input = createAlertSchema.parse(await readJson(request));
  return ok(await createAlert(input), { status: 201 });
});
