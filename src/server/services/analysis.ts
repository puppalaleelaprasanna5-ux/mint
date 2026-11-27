import "server-only";
import { buildTechnicalSummary, type TechnicalSummary } from "@/lib/technical-summary";
import { buildExplanationContext } from "@/lib/ai/context";
import type { BarsResponseDTO, InstrumentWithQuoteDTO } from "@/lib/types";
import { explainStock } from "@/server/ai/explain";
import { createAIProvider } from "@/server/ai/registry";
import type { ExplanationResult } from "@/server/ai/types";
import { getBenchmark } from "./markets";

type Benchmark = Awaited<ReturnType<typeof getBenchmark>>;

/** Technical + risk analysis for an instrument (pure engines over stored bars). */
export function technicalAnalysisFor(
  instrument: InstrumentWithQuoteDTO,
  history: BarsResponseDTO,
  benchmark: Benchmark,
): TechnicalSummary {
  return buildTechnicalSummary(history.bars, {
    isSimulated: history.provenance?.isSimulated ?? true,
    benchmark: benchmark ? { name: benchmark.name, bars: benchmark.bars, isSimulated: benchmark.isSimulated } : null,
    benchmarkIsSelf: benchmark?.instrumentId === instrument.id,
  });
}

/**
 * AI explanation of an already-computed analysis. Runs strictly AFTER the analysis exists and
 * never throws, so AI problems cannot affect the technical and risk results.
 */
export async function aiExplanationFor(
  instrument: InstrumentWithQuoteDTO,
  summary: TechnicalSummary,
  options: { timeoutMs?: number } = {},
): Promise<ExplanationResult> {
  try {
    const { provider } = createAIProvider();
    const ctx = buildExplanationContext(
      { symbol: instrument.symbol, name: instrument.name, type: instrument.type, market: instrument.market.code, currency: instrument.currency },
      summary,
    );
    return await explainStock(provider, ctx, options);
  } catch (err) {
    // explainStock never throws; this guards context building and provider construction.
    console.error("[ai] explanation setup failed", err instanceof Error ? err.message : err);
    return { status: "error", code: "PROVIDER_ERROR", reason: "AI explanation could not be prepared.", provider: "unknown" };
  }
}
