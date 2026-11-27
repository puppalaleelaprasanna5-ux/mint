import "server-only";
import type { AIProvider, AIProviderStatus } from "./types";
import { MockAIProvider } from "./providers/mock";

export type Env = Record<string, string | undefined>;

/**
 * Selects the AI provider from server-side env. AI is OFF unless AI_PROVIDER is set.
 * - AI_PROVIDER unset or "none": disabled
 * - AI_PROVIDER="mock": deterministic mock (development/testing)
 * - anything else (e.g. "groq"): reported as not available yet. No network calls are made.
 */
export function createAIProvider(env: Env = process.env): { provider: AIProvider | null; status: AIProviderStatus } {
  const choice = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (choice === "" || choice === "none") {
    return {
      provider: null,
      status: { id: "none", name: "AI disabled", configured: false, missingEnv: ["AI_PROVIDER"], isMock: false, notes: ["Set AI_PROVIDER to enable AI explanations."] },
    };
  }
  if (choice === "mock") {
    const provider = new MockAIProvider();
    return { provider, status: provider.status() };
  }
  return {
    provider: null,
    status: {
      id: choice.slice(0, 30),
      name: choice.slice(0, 30),
      configured: false,
      missingEnv: [],
      isMock: false,
      notes: [`AI provider "${choice.slice(0, 30)}" is not implemented yet. Supported: "mock".`],
    },
  };
}
