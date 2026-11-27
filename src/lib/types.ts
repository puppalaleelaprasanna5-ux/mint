/** Serializable DTOs shared by API route handlers, server components and client components. */

export type RegionCode = "IN" | "US";
export type InstrumentTypeCode = "EQUITY" | "INDEX" | "ETF";
export type PriceAlertType = "PRICE_ABOVE" | "PRICE_BELOW";
export type AlertStatusCode = "ACTIVE" | "PAUSED" | "TRIGGERED";

export interface MarketDTO {
  id: string;
  code: string;
  mic: string;
  name: string;
  region: RegionCode;
  timezone: string;
  currency: string;
  openTime: string;
  closeTime: string;
}

export interface SessionDTO {
  state: "OPEN" | "PRE_OPEN" | "CLOSED" | "WEEKEND";
  label: string;
  localTime: string;
  localDate: string;
}

/** Provenance attached to every market-data value shown to the user. */
export interface DataProvenance {
  source: string;
  isSimulated: boolean;
  /** Exchange-local trading date of the latest bar used. */
  asOfTradingDate: string;
  /** When Mint stored the data (UTC ISO). */
  fetchedAt: string;
}

export interface QuoteDTO {
  last: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number;
  provenance: DataProvenance;
}

export interface InstrumentSummaryDTO {
  id: string;
  symbol: string;
  name: string;
  type: InstrumentTypeCode;
  currency: string;
  sector: string | null;
  market: { code: string; region: RegionCode; timezone: string };
}

export interface InstrumentWithQuoteDTO extends InstrumentSummaryDTO {
  quote: QuoteDTO | null;
}

export interface BarDTO {
  time: string; // exchange-local trading date "YYYY-MM-DD"
  timestamp: string; // UTC ISO bar start
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarsResponseDTO {
  instrument: InstrumentSummaryDTO;
  interval: "ONE_DAY";
  bars: BarDTO[];
  provenance: DataProvenance | null;
}

export interface IndexSnapshotDTO extends InstrumentWithQuoteDTO {
  sparkline: { time: string; close: number }[];
}

export interface RegionOverviewDTO {
  region: RegionCode;
  label: string;
  markets: (MarketDTO & { session: SessionDTO })[];
  indices: IndexSnapshotDTO[];
}

export interface WatchlistItemDTO {
  id: string;
  note: string | null;
  addedAt: string;
  instrument: InstrumentWithQuoteDTO;
}

export interface WatchlistDTO {
  id: string;
  name: string;
  isDefault: boolean;
  items: WatchlistItemDTO[];
}

export interface WatchlistSummaryDTO {
  id: string;
  name: string;
  isDefault: boolean;
  itemCount: number;
}

export interface AlertDTO {
  id: string;
  type: "PRICE_ABOVE" | "PRICE_BELOW" | "PERCENT_CHANGE_UP" | "PERCENT_CHANGE_DOWN" | "VOLUME_SPIKE";
  threshold: number;
  status: AlertStatusCode;
  note: string | null;
  createdAt: string;
  lastEvaluatedAt: string | null;
  triggeredAt: string | null;
  triggeredValue: number | null;
  instrument: InstrumentWithQuoteDTO;
}

export interface AlertEvaluationResultDTO {
  evaluated: number;
  triggered: { alertId: string; symbol: string; value: number }[];
  skipped: { alertId: string; reason: string }[];
  evaluatedAt: string;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
