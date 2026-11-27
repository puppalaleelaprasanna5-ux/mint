import { ok, route } from "@/server/http";
import { listNotifications } from "@/server/services/alerts";

/** GET /api/notifications — most recent notifications (alert triggers). */
export const GET = route(async () => ok(await listNotifications(50)));
