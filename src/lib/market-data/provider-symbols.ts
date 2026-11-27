/**
 * Provider symbol mappings for Mint's instrument universe.
 *
 * Upstox keys were copied from Upstox's official beginning-of-day instrument files
 * (https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz and BSE.json.gz),
 * matched by `trading_symbol` / index `name`, on 2026-11-27. Equity keys embed the ISIN, which is
 * stable across symbol renames. Re-verify if Upstox reports UDAPI100011 (invalid instrument key).
 *
 * Alpaca uses the plain US ticker. Alpaca has no index data, so IXIC and SPX are unmapped and
 * remain on simulated data.
 */
export const UPSTOX_VERIFIED_FROM = "Upstox BOD instrument file (NSE/BSE), 2026-11-27";
export const ALPACA_VERIFIED_FROM = "US ticker symbol";

export interface ProviderSymbolMapping {
  market: string; // Mint market code
  symbol: string; // Mint symbol
  provider: "upstox" | "alpaca";
  providerSymbol: string;
  verifiedFrom: string;
}

const UPSTOX: Record<string, { market: string; key: string }> = {
  NIFTY50: { market: "NSE", key: "NSE_INDEX|Nifty 50" },
  SENSEX: { market: "BSE", key: "BSE_INDEX|SENSEX" },
  RELIANCE: { market: "NSE", key: "NSE_EQ|INE002A01018" },
  TCS: { market: "NSE", key: "NSE_EQ|INE467B01029" },
  HDFCBANK: { market: "NSE", key: "NSE_EQ|INE040A01034" },
  INFY: { market: "NSE", key: "NSE_EQ|INE009A01021" },
  ICICIBANK: { market: "NSE", key: "NSE_EQ|INE090A01021" },
  ITC: { market: "NSE", key: "NSE_EQ|INE154A01025" },
  SBIN: { market: "NSE", key: "NSE_EQ|INE062A01020" },
  BHARTIARTL: { market: "NSE", key: "NSE_EQ|INE397D01024" },
};

const ALPACA: Record<string, string> = {
  AAPL: "NASDAQ",
  MSFT: "NASDAQ",
  NVDA: "NASDAQ",
  GOOGL: "NASDAQ",
  AMZN: "NASDAQ",
  JPM: "NYSE",
  KO: "NYSE",
  JNJ: "NYSE",
  XOM: "NYSE",
};

export const PROVIDER_SYMBOLS: ProviderSymbolMapping[] = [
  ...Object.entries(UPSTOX).map(([symbol, v]) => ({
    market: v.market,
    symbol,
    provider: "upstox" as const,
    providerSymbol: v.key,
    verifiedFrom: UPSTOX_VERIFIED_FROM,
  })),
  ...Object.entries(ALPACA).map(([symbol, market]) => ({
    market,
    symbol,
    provider: "alpaca" as const,
    providerSymbol: symbol,
    verifiedFrom: ALPACA_VERIFIED_FROM,
  })),
];
