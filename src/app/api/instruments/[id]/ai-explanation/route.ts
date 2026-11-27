import { ok, route } from "@/server/http";
import { getInstrumentWithQuote } from "@/server/services/instruments";
import { getDailyBars } from "@/server/services/prices";
import { getBenchmark } from "@/server/services/markets";
import { aiExplanationFor, technicalAnalysisFor } from "@/server/services/analysis";

/**
 * GET /api/instruments/:id/ai-explanation
 * The technical analysis is computed first; the AI result is attached separately and never
 * replaces or blocks it. AI failures are reported in `ai.status`, still with HTTP 200.
 */
export const GET = route(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const instrument = await getInstrumentWithQuote(id);
  const [history, benchmark] = await Promise.all([getDailyBars(id, { limit: 5000 }), getBenchmark(instrument.market.region)]);
  const analysis = technicalAnalysisFor(instrument, history, benchmark);
  const ai = await aiExplanationFor(instrument, analysis);
  return ok({
    instrument: { id: instrument.id, symbol: instrument.symbol },
    analysis: { asOf: analysis.asOf, barsAnalyzed: analysis.barsAnalyzed, available: Boolean(analysis.snapshot), error: analysis.error },
    ai,
  });
});
