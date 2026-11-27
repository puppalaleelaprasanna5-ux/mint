import { ok, readJson, route } from "@/server/http";
import { deleteAlert, updateAlert } from "@/server/services/alerts";
import { updateAlertSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/alerts/:id { status?: ACTIVE|PAUSED, threshold?, note? } — ACTIVE re-arms a triggered alert. */
export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const patch = updateAlertSchema.parse(await readJson(request));
  return ok(await updateAlert(id, patch));
});

/** DELETE /api/alerts/:id */
export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await deleteAlert(id);
  return ok({ deleted: true });
});
