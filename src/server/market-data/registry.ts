/**
 * Builds provider adapters from server-side environment variables.
 * Credentials are read only here and are never sent to the browser or returned by any API.
 */
import type { MarketDataProvider, ProviderId } from "@/lib/market-data/types";
import { AlpacaProvider } from "./providers/alpaca";
import { UpstoxProvider } from "./providers/upstox";

export type Env = Record<string, string | undefined>;

export function createProviders(env: Env = process.env): Record<ProviderId, MarketDataProvider> {
  return {
    upstox: new UpstoxProvider({ accessToken: env.UPSTOX_ACCESS_TOKEN }),
    alpaca: new AlpacaProvider({
      keyId: env.ALPACA_API_KEY_ID,
      secretKey: env.ALPACA_API_SECRET_KEY,
      feed: env.ALPACA_DATA_FEED,
    }),
  };
}

export const PROVIDER_IDS: ProviderId[] = ["upstox", "alpaca"];
