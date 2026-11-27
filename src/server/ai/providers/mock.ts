import "server-only";
import type { StockExplanationContext } from "@/lib/ai/context";
import { AIError, type AIProvider, type AIProviderStatus, type GenerateOptions } from "../types";

/**
 * Deterministic mock provider for development and tests. It builds a template explanation from
 * the context, so the output is always grounded in Mint's own numbers. No network, no keys.
 *
 * `mode` simulates failures so callers can be tested:
 * - "ok": valid explanation        - "invalid": wrong shape    - "unsafe": violates the content policy
 * - "error": provider throws       - "hang": never resolves (until aborted)
 */
export type MockMode = "ok" | "invalid" | "unsafe" | "error" | "hang";

const DIR: Record<string, string> = {
  bullish: "an uptrend",
  bearish: "a downtrend",
  sideways: "a sideways pattern with no clear direction",
  insufficient_data: "not enough history to judge",
};

function describeHorizon(h: { direction: string; confidence: string; conflicting: boolean }, label: string): string {
  if (h.direction === "insufficient_data") return `There is not enough price history yet for a ${label} view.`;
  if (h.conflicting) return `Over the ${label}, the signals disagree, so there is no clear trend.`;
  return `Over the ${label}, prices have shown ${DIR[h.direction] ?? h.direction} (${h.confidence} confidence).`;
}

export function mockExplanation(ctx: StockExplanationContext) {
  const { instrument, data, trend, momentum, risk, levels } = ctx;
  const simulatedNote = data.isSimulated ? " These prices are SIMULATED, not real market data." : "";
  const rsiText = momentum?.rsi != null ? `RSI is ${momentum.rsi}${momentum.rsiZone ? ` (${momentum.rsiZone})` : ""}.` : "RSI is not available yet.";
  return {
    summary: `${instrument.name} (${instrument.symbol}) analysed from ${data.barsAnalyzed} daily closes up to ${data.asOf ?? "n/a"}.${simulatedNote} This is a mock explanation for development.`,
    trend: {
      shortTerm: trend ? describeHorizon(trend.shortTerm, "short term") : "Trend data is not available.",
      longTerm: trend ? describeHorizon(trend.longTerm, "long term") : "Trend data is not available.",
    },
    momentum: momentum ? `Momentum has been ${momentum.bias}. ${rsiText}` : "Momentum data is not available.",
    risk:
      risk && risk.volatilityPct != null
        ? `Risk level is ${risk.level.replace("_", " ")}, with annualized volatility of ${risk.volatilityPct}%${
            risk.maxDrawdownPct != null ? ` and a worst fall of ${risk.maxDrawdownPct}%` : ""
          }.`
        : "There is not enough history to measure risk yet.",
    keyLevels:
      levels && (levels.nearestSupport != null || levels.nearestResistance != null)
        ? `The last close was ${levels.close}. Nearest support is around ${levels.nearestSupport ?? "none found"} and nearest resistance around ${
            levels.nearestResistance ?? "none found"
          }.`
        : "No clear support or resistance levels were found.",
    considerations: ["Compare the short-term and long-term trend to see whether they agree.", "Check how the price behaved near the listed support and resistance levels."],
    limitations: [
      "Based only on past daily prices; news and company results are not considered.",
      ...(data.isSimulated ? ["The underlying prices are simulated."] : []),
    ],
    confidence: (trend?.longTerm.confidence === "high" ? "medium" : "low") as "low" | "medium" | "high",
  };
}

export class MockAIProvider implements AIProvider {
  readonly id = "mock";
  readonly name = "Mock AI (development)";
  constructor(private readonly mode: MockMode = "ok") {}

  status(): AIProviderStatus {
    return {
      id: this.id,
      name: this.name,
      configured: true,
      missingEnv: [],
      isMock: true,
      notes: ["Deterministic template output for development and tests. Not a real AI model."],
    };
  }

  async generateStockExplanation(ctx: StockExplanationContext, { signal }: GenerateOptions): Promise<unknown> {
    switch (this.mode) {
      case "error":
        throw new AIError("PROVIDER_ERROR", "Mock provider failure");
      case "invalid":
        return { summary: "Missing every other field" };
      case "unsafe":
        return { ...mockExplanation(ctx), summary: "The price will rise next month; this is guaranteed." };
      case "hang":
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new AIError("TIMEOUT", "Mock provider aborted")), { once: true });
        });
      default:
        return JSON.stringify(mockExplanation(ctx)); // real providers return text; exercise JSON parsing
    }
  }
}
