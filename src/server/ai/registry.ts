import "server-only";
import type { AIProvider, AIProviderStatus } from "./types";
import { MockAIProvider } from "./providers/mock";
import { GROQ_DEFAULT_MODEL, GroqProvider, isValidGroqModel } from "./providers/groq";

export type Env = Record<string, string | undefined>;

const disabled = (notes: string[], missingEnv: string[] = []): { provider: null; status: AIProviderStatus } => ({
  provider: null,
  status: { id: "none", name: "AI disabled", configured: false, missingEnv, isMock: false, notes },
});

/**
 * Selects the AI provider from server-side env. AI is OFF unless AI_PROVIDER is set explicitly;
 * having a key alone never sends data to an external service.
 * - AI_PROVIDER unset or "none": disabled
 * - AI_PROVIDER="mock": deterministic mock (development/testing)
 * - AI_PROVIDER="groq": Groq, requires GROQ_API_KEY; optional GROQ_MODEL
 */
export function createAIProvider(env: Env = process.env): { provider: AIProvider | null; status: AIProviderStatus } {
  const choice = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  const hasGroqKey = Boolean(env.GROQ_API_KEY?.trim());

  if (choice === "" || choice === "none") {
    return disabled(
      hasGroqKey
        ? ["AI explanations are turned off. GROQ_API_KEY is set; add AI_PROVIDER=groq to .env to enable Groq."]
        : ["AI explanations are turned off. Set AI_PROVIDER to enable them."],
      ["AI_PROVIDER"],
    );
  }
  if (choice === "mock") {
    const provider = new MockAIProvider();
    return { provider, status: provider.status() };
  }
  if (choice === "groq") {
    if (!hasGroqKey) {
      return disabled(["AI_PROVIDER=groq, but GROQ_API_KEY is not set, so AI explanations are turned off."], ["GROQ_API_KEY"]);
    }
    const requested = env.GROQ_MODEL?.trim();
    const provider = new GroqProvider({ apiKey: env.GROQ_API_KEY, model: requested });
    const status = provider.status();
    if (requested && !isValidGroqModel(requested)) {
      status.notes.push(`GROQ_MODEL is not a valid model id; using ${GROQ_DEFAULT_MODEL}.`);
    }
    return { provider, status };
  }
  const name = choice.slice(0, 30);
  return disabled([`AI provider "${name}" is not supported. Use "groq" or "mock".`]);
}
