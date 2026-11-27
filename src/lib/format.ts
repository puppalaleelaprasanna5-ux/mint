/** Display formatting helpers. Always pass explicit locales/time zones to avoid SSR hydration drift. */

function localeFor(currency: string): string {
  return currency === "INR" ? "en-IN" : "en-US";
}

/** Money with currency symbol, e.g. ₹1,234.50 or $1,234.50. */
export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(localeFor(currency), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Index level (points, no currency), e.g. 24,312.55. */
export function formatPoints(value: number, currency: string): string {
  return new Intl.NumberFormat(localeFor(currency), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Price for an instrument: indices are shown in points, others with currency symbol. */
export function formatPrice(value: number, currency: string, type: string): string {
  return type === "INDEX" ? formatPoints(value, currency) : formatMoney(value, currency);
}

export function formatSignedNumber(value: number, currency: string): string {
  const abs = new Intl.NumberFormat(localeFor(currency), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${abs}`;
}

export function formatPercent(value: number, { signed = true }: { signed?: boolean } = {}): string {
  const abs = Math.abs(value).toFixed(2);
  const sign = !signed ? (value < 0 ? "−" : "") : value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${abs}%`;
}

/** Compact volume: Indian units (L/Cr) for INR, K/M/B for USD. */
export function formatVolume(value: number, currency: string): string {
  return new Intl.NumberFormat(localeFor(currency), {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

/** "26 Nov 2026" from a "YYYY-MM-DD" trading date (calendar date, no zone shifting). */
export function formatTradingDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Instant rendered in a specific zone, e.g. "27 Nov 2026, 15:30 IST". */
export function formatInstant(iso: string | Date, timeZone: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
  // Intl renders India as "GMT+5:30"; IST is the familiar abbreviation.
  return timeZone === "Asia/Kolkata" ? text.replace("GMT+5:30", "IST") : text;
}
