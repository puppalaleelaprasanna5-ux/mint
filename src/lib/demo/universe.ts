/**
 * Demo market universe. Exchange metadata (codes, MICs, time zones, currencies, regular hours)
 * is factual reference data. PRICE PARAMETERS BELOW ARE ONLY INPUTS TO A RANDOM SIMULATION —
 * they are rough magnitudes chosen so charts look plausible, not real market levels.
 */

export const DEMO_SOURCE = "mint-demo-generator";

export interface DemoMarket {
  code: string;
  mic: string;
  name: string;
  region: "IN" | "US";
  countryCode: string;
  timezone: string;
  currency: string;
  openTime: string;
  closeTime: string;
}

export const DEMO_MARKETS: DemoMarket[] = [
  { code: "NSE", mic: "XNSE", name: "National Stock Exchange of India", region: "IN", countryCode: "IN", timezone: "Asia/Kolkata", currency: "INR", openTime: "09:15", closeTime: "15:30" },
  { code: "BSE", mic: "XBOM", name: "BSE (Bombay Stock Exchange)", region: "IN", countryCode: "IN", timezone: "Asia/Kolkata", currency: "INR", openTime: "09:15", closeTime: "15:30" },
  { code: "NASDAQ", mic: "XNAS", name: "Nasdaq Stock Market", region: "US", countryCode: "US", timezone: "America/New_York", currency: "USD", openTime: "09:30", closeTime: "16:00" },
  { code: "NYSE", mic: "XNYS", name: "New York Stock Exchange", region: "US", countryCode: "US", timezone: "America/New_York", currency: "USD", openTime: "09:30", closeTime: "16:00" },
];

export interface DemoInstrument {
  market: string; // DemoMarket.code
  symbol: string;
  name: string;
  type: "EQUITY" | "INDEX" | "ETF";
  sector?: string;
  /** Simulation inputs only. */
  sim: {
    startPrice: number;
    annualDrift: number; // 0.10 = 10%/yr
    annualVol: number; // 0.25 = 25%/yr
    marketCorrelation: number; // 0..1 correlation with the regional factor
    baseVolume: number; // 0 for indices
  };
}

export const DEMO_INSTRUMENTS: DemoInstrument[] = [
  // India — indices
  { market: "NSE", symbol: "NIFTY50", name: "NIFTY 50", type: "INDEX", sim: { startPrice: 22000, annualDrift: 0.11, annualVol: 0.14, marketCorrelation: 0.97, baseVolume: 0 } },
  { market: "BSE", symbol: "SENSEX", name: "BSE SENSEX", type: "INDEX", sim: { startPrice: 72500, annualDrift: 0.105, annualVol: 0.14, marketCorrelation: 0.97, baseVolume: 0 } },
  // India — equities (NSE)
  { market: "NSE", symbol: "RELIANCE", name: "Reliance Industries", type: "EQUITY", sector: "Energy", sim: { startPrice: 1250, annualDrift: 0.09, annualVol: 0.24, marketCorrelation: 0.7, baseVolume: 9_000_000 } },
  { market: "NSE", symbol: "TCS", name: "Tata Consultancy Services", type: "EQUITY", sector: "Information Technology", sim: { startPrice: 3700, annualDrift: 0.07, annualVol: 0.22, marketCorrelation: 0.55, baseVolume: 2_500_000 } },
  { market: "NSE", symbol: "HDFCBANK", name: "HDFC Bank", type: "EQUITY", sector: "Financials", sim: { startPrice: 1550, annualDrift: 0.1, annualVol: 0.21, marketCorrelation: 0.72, baseVolume: 14_000_000 } },
  { market: "NSE", symbol: "INFY", name: "Infosys", type: "EQUITY", sector: "Information Technology", sim: { startPrice: 1500, annualDrift: 0.08, annualVol: 0.26, marketCorrelation: 0.55, baseVolume: 6_500_000 } },
  { market: "NSE", symbol: "ICICIBANK", name: "ICICI Bank", type: "EQUITY", sector: "Financials", sim: { startPrice: 1100, annualDrift: 0.13, annualVol: 0.22, marketCorrelation: 0.72, baseVolume: 12_000_000 } },
  { market: "NSE", symbol: "ITC", name: "ITC", type: "EQUITY", sector: "Consumer Staples", sim: { startPrice: 430, annualDrift: 0.06, annualVol: 0.19, marketCorrelation: 0.45, baseVolume: 11_000_000 } },
  { market: "NSE", symbol: "SBIN", name: "State Bank of India", type: "EQUITY", sector: "Financials", sim: { startPrice: 760, annualDrift: 0.12, annualVol: 0.28, marketCorrelation: 0.7, baseVolume: 13_000_000 } },
  { market: "NSE", symbol: "BHARTIARTL", name: "Bharti Airtel", type: "EQUITY", sector: "Communication Services", sim: { startPrice: 1400, annualDrift: 0.15, annualVol: 0.23, marketCorrelation: 0.6, baseVolume: 7_000_000 } },
  // US — indices (S&P 500 is calculated across NYSE and Nasdaq listings; grouped under NYSE here)
  { market: "NASDAQ", symbol: "IXIC", name: "NASDAQ Composite", type: "INDEX", sim: { startPrice: 16500, annualDrift: 0.12, annualVol: 0.2, marketCorrelation: 0.95, baseVolume: 0 } },
  { market: "NYSE", symbol: "SPX", name: "S&P 500", type: "INDEX", sim: { startPrice: 5200, annualDrift: 0.1, annualVol: 0.16, marketCorrelation: 0.98, baseVolume: 0 } },
  // US — equities
  { market: "NASDAQ", symbol: "AAPL", name: "Apple", type: "EQUITY", sector: "Information Technology", sim: { startPrice: 190, annualDrift: 0.1, annualVol: 0.27, marketCorrelation: 0.7, baseVolume: 55_000_000 } },
  { market: "NASDAQ", symbol: "MSFT", name: "Microsoft", type: "EQUITY", sector: "Information Technology", sim: { startPrice: 410, annualDrift: 0.11, annualVol: 0.24, marketCorrelation: 0.72, baseVolume: 21_000_000 } },
  { market: "NASDAQ", symbol: "NVDA", name: "NVIDIA", type: "EQUITY", sector: "Information Technology", sim: { startPrice: 110, annualDrift: 0.2, annualVol: 0.5, marketCorrelation: 0.6, baseVolume: 240_000_000 } },
  { market: "NASDAQ", symbol: "GOOGL", name: "Alphabet (Class A)", type: "EQUITY", sector: "Communication Services", sim: { startPrice: 160, annualDrift: 0.11, annualVol: 0.3, marketCorrelation: 0.65, baseVolume: 26_000_000 } },
  { market: "NASDAQ", symbol: "AMZN", name: "Amazon.com", type: "EQUITY", sector: "Consumer Discretionary", sim: { startPrice: 180, annualDrift: 0.12, annualVol: 0.32, marketCorrelation: 0.68, baseVolume: 40_000_000 } },
  { market: "NYSE", symbol: "JPM", name: "JPMorgan Chase & Co.", type: "EQUITY", sector: "Financials", sim: { startPrice: 200, annualDrift: 0.1, annualVol: 0.22, marketCorrelation: 0.65, baseVolume: 9_000_000 } },
  { market: "NYSE", symbol: "KO", name: "Coca-Cola", type: "EQUITY", sector: "Consumer Staples", sim: { startPrice: 62, annualDrift: 0.05, annualVol: 0.15, marketCorrelation: 0.4, baseVolume: 13_000_000 } },
  { market: "NYSE", symbol: "JNJ", name: "Johnson & Johnson", type: "EQUITY", sector: "Health Care", sim: { startPrice: 155, annualDrift: 0.04, annualVol: 0.17, marketCorrelation: 0.4, baseVolume: 7_000_000 } },
  { market: "NYSE", symbol: "XOM", name: "Exxon Mobil", type: "EQUITY", sector: "Energy", sim: { startPrice: 110, annualDrift: 0.06, annualVol: 0.25, marketCorrelation: 0.45, baseVolume: 15_000_000 } },
];

/** Watchlist created by the seed so the dashboard is not empty on first run. */
export const DEMO_WATCHLIST = {
  name: "My Watchlist",
  symbols: [
    { market: "NSE", symbol: "RELIANCE" },
    { market: "NSE", symbol: "TCS" },
    { market: "NSE", symbol: "HDFCBANK" },
    { market: "NASDAQ", symbol: "AAPL" },
    { market: "NASDAQ", symbol: "NVDA" },
    { market: "NYSE", symbol: "JPM" },
  ],
};

/** Number of simulated trading days generated per instrument (~1.6 years of weekdays). */
export const DEMO_TRADING_DAYS = 400;
