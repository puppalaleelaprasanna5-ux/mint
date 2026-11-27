import { z } from "zod";

export const regionSchema = z.enum(["IN", "US"]);
export const marketFilterSchema = z.enum(["ALL", "IN", "US"]);
export type MarketFilter = z.infer<typeof marketFilterSchema>;

const id = z.string().trim().min(1, "id is required").max(64);

/** Parses `?market=` from the UI; unknown values fall back to ALL. */
export function parseMarketFilter(value: unknown): MarketFilter {
  const parsed = marketFilterSchema.safeParse(typeof value === "string" ? value.toUpperCase() : value);
  return parsed.success ? parsed.data : "ALL";
}

export const instrumentSearchQuerySchema = z.object({
  q: z.string().trim().max(50).optional().default(""),
  region: regionSchema.optional(),
  type: z.enum(["EQUITY", "INDEX", "ETF"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const barsQuerySchema = z
  .object({
    interval: z.enum(["1d"]).optional().default("1d"),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(5000).optional().default(500),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must be on or before `to`" });

export const overviewQuerySchema = z.object({
  region: marketFilterSchema.optional().default("ALL"),
});

export const createWatchlistSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40, "Name must be 40 characters or fewer"),
});

export const updateWatchlistSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine((v) => v.name !== undefined || v.isDefault !== undefined, { message: "Nothing to update" });

export const addWatchlistItemSchema = z.object({
  instrumentId: id,
  note: z.string().trim().max(200).optional(),
});

/** Phase 1 supports price-level alerts only; other alert types are reserved for Phase 7. */
export const createAlertSchema = z.object({
  instrumentId: id,
  type: z.enum(["PRICE_ABOVE", "PRICE_BELOW"]),
  threshold: z.coerce.number().positive("Price must be greater than 0").max(1e9).finite(),
  note: z.string().trim().max(200).optional(),
});

export const updateAlertSchema = z
  .object({
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    threshold: z.coerce.number().positive().max(1e9).finite().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update" });

/** Turns URLSearchParams into a plain object for Zod (drops empty strings). */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params) if (v !== "") out[k] = v;
  return out;
}

export const marketDataSyncSchema = z.object({
  providers: z.array(z.enum(["upstox", "alpaca"])).min(1).max(2).optional(),
  symbols: z
    .array(z.string().trim().toUpperCase().regex(/^[A-Z0-9&.-]{1,20}$/, "Invalid symbol"))
    .max(50)
    .optional(),
  lookbackDays: z.coerce.number().int().min(1).max(3650).optional(),
});
