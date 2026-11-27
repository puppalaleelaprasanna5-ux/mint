import "server-only";
import type { StockExplanationContext } from "@/lib/ai/context";
import { AI_DISCLAIMER, findPolicyViolations, stockExplanationSchema, type StockExplanation } from "@/lib/ai/schema";
import { AIError, type AIProvider, type ExplanationResult } from "./types";

export const DEFAULT_AI_TIMEOUT_MS = 15_000;

function parseRaw(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  // Accept a bare JSON object, optionally wrapped in a ```json fence.
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AIError("INVALID_RESPONSE", "Provider output was not valid JSON");
  }
}

/** Safety post-processing Mint applies regardless of what the provider wrote. */
function enforceSafety(explanation: StockExplanation, ctx: StockExplanationContext): StockExplanation {
  const limitations = [...explanation.limitations];
  if (ctx.data.isSimulated && !limitations.some((l) => /simulated/i.test(l))) {
    limitations.unshift("The underlying prices are SIMULATED, not real market data.");
  }
  return { ...explanation, limitations: limitations.slice(0, 5) };
}

/**
 * Generates and validates a stock explanation. NEVER throws: every failure (disabled AI, missing
 * data, timeout, provider crash, malformed or unsafe output) becomes a structured result, so
 * callers can always fall back to Mint's own technical and risk analysis.
 */
export async function explainStock(
  provider: AIProvider | null,
  ctx: StockExplanationContext,
  { timeoutMs = DEFAULT_AI_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ExplanationResult> {
  if (!provider) return { status: "disabled", reason: "AI explanations are turned off (set AI_PROVIDER to enable)." };
  const providerName = provider.name;
  if (!ctx.hasAnalysis) {
    return { status: "error", code: "INSUFFICIENT_DATA", reason: "Not enough analysed price data to explain.", provider: providerName };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AIError("TIMEOUT", `No response within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });

  try {
    // Providers get a private deep copy: whatever they do to it cannot reach Mint's analysis
    // (the context shares arrays such as momentum cautions with the technical summary).
    const raw = await Promise.race([
      Promise.resolve().then(() => provider.generateStockExplanation(structuredClone(ctx), { signal: controller.signal })),
      timeout,
    ]);
    const parsed = stockExplanationSchema.safeParse(parseRaw(raw));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AIError("INVALID_RESPONSE", `Provider output did not match the schema (${issue?.path.join(".") || "root"}: ${issue?.message})`);
    }
    const violations = findPolicyViolations(parsed.data);
    if (violations.length) {
      const v = violations[0];
      throw new AIError("POLICY_VIOLATION", `Withheld: the explanation ${v.reason} ("${v.phrase}" in ${v.field})`);
    }
    const status = provider.status();
    return {
      status: "ok",
      explanation: enforceSafety(parsed.data, ctx),
      provider: providerName,
      isMock: status.isMock,
      generatedAt: new Date().toISOString(),
      disclaimer: AI_DISCLAIMER,
    };
  } catch (err) {
    if (err instanceof AIError) return { status: "error", code: err.kind, reason: err.message, provider: providerName };
    console.error("[ai] unexpected provider error", err instanceof Error ? err.message : err);
    return { status: "error", code: "PROVIDER_ERROR", reason: "The AI provider failed unexpectedly.", provider: providerName };
  } finally {
    clearTimeout(timer);
  }
}
