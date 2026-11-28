import type { CompanyLookupProvider, CompanyLookupStatus } from "./company-lookup";
import { isValidSecUserAgent, SecEdgarProvider } from "./providers/sec-edgar";

export type Env = Record<string, string | undefined>;

/**
 * Company lookup is enabled for US listings when SEC_USER_AGENT is set to a valid
 * "<app name> <contact email>" string; SEC's fair-access policy requires that identification.
 * Nothing is sent to SEC otherwise. The value is never echoed in status or errors.
 */
export function createCompanyLookupProvider(env: Env = process.env): { provider: CompanyLookupProvider | null; status: CompanyLookupStatus } {
  const ua = env.SEC_USER_AGENT;
  if (isValidSecUserAgent(ua)) {
    const provider = new SecEdgarProvider({ userAgent: ua });
    return { provider, status: provider.status() };
  }
  return {
    provider: null,
    status: {
      id: "none",
      name: "Company lookup disabled",
      configured: false,
      missingEnv: ["SEC_USER_AGENT"],
      notes: [
        ua?.trim()
          ? 'SEC_USER_AGENT is set but invalid. Use "<app name> <your contact email>", e.g. "Mint personal research you@yourdomain.com".'
          : 'Set SEC_USER_AGENT to "<app name> <your contact email>" to enable SEC EDGAR company lookup for US stocks.',
      ],
    },
  };
}
