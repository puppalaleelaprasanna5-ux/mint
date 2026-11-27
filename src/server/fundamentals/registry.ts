import type { FundamentalsProvider, FundamentalsProviderStatus } from "./provider";
import { MockFundamentalsProvider } from "./providers/mock";

export type Env = Record<string, string | undefined>;

/**
 * Selects the fundamentals provider from server-side env. OFF unless FUNDAMENTALS_PROVIDER is set.
 * - unset / "none": disabled (fundamentals report as unavailable)
 * - "mock": deterministic mock data, labelled MOCK everywhere
 * No real provider exists yet (Phase 5A), so no API keys are read.
 */
export function createFundamentalsProvider(env: Env = process.env): {
  provider: FundamentalsProvider | null;
  status: FundamentalsProviderStatus;
} {
  const choice = (env.FUNDAMENTALS_PROVIDER ?? "").trim().toLowerCase();
  if (choice === "mock") {
    const provider = new MockFundamentalsProvider();
    return { provider, status: provider.status() };
  }
  const notes =
    choice === "" || choice === "none"
      ? ["Fundamental data is turned off. Set FUNDAMENTALS_PROVIDER to enable it."]
      : [`Fundamentals provider "${choice.slice(0, 30)}" is not supported. Use "mock".`];
  return {
    provider: null,
    status: { id: "none", name: "Fundamentals disabled", origin: null, configured: false, missingEnv: ["FUNDAMENTALS_PROVIDER"], notes },
  };
}
