import { ok, route } from "@/server/http";
import { evaluateAlerts } from "@/server/services/alerts";

/** POST /api/alerts/evaluate — check ACTIVE price alerts against the latest stored close. */
export const POST = route(async () => ok(await evaluateAlerts()));
