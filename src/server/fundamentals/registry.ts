import type { FundamentalsProvider, FundamentalsProviderStatus } from "./provider";
import { MockFundamentalsProvider } from "./providers/mock";
import { isValidSecUserAgent, SecEdgarProvider } from "./providers/sec-edgar";
import { SecFinancialsProvider } from "./providers/sec-financials";

export type Env = Record<string, string | undefined>;

const disabled = (notes: string[], missingEnv: string[]): { provider: null; status: FundamentalsProviderStatus } => ({
  provider: null,
  status: { id: "none", name: "Fundamentals disabled", origin: null, configured: false, missingEnv, notes },
});

/**
 * Selects the fundamentals provider from server-side env. OFF unless FUNDAMENTALS_PROVIDER is set.
 * - unset / "none": disabled (fundamentals report as unavailable)
 * - "mock": deterministic mock data, labelled MOCK everywhere
 * - "sec":  real US GAAP statements from SEC EDGAR (US listings only); needs SEC_USER_AGENT, no API key
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
  if (choice === "sec") {
    if (!isValidSecUserAgent(env.SEC_USER_AGENT)) {
      return disabled(['FUNDAMENTALS_PROVIDER=sec needs SEC_USER_AGENT set to "<app name> <your contact email>".'], ["SEC_USER_AGENT"]);
    }
    const provider = new SecFinancialsProvider(new SecEdgarProvider({ userAgent: env.SEC_USER_AGENT }));
    return { provider, status: provider.status() };
  }
  return disabled(
    choice === "" || choice === "none"
      ? ["Fundamental data is turned off. Set FUNDAMENTALS_PROVIDER to enable it."]
      : [`Fundamentals provider "${choice.slice(0, 30)}" is not supported. Use "sec" or "mock".`],
    ["FUNDAMENTALS_PROVIDER"],
  );
}
