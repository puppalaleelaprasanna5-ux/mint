/**
 * Exchange time-zone helpers built on the platform Intl API (no extra dependencies).
 *
 * Limitations (Phase 1): exchange holidays and special sessions are NOT modelled.
 * Weekends are treated as non-trading days. A full trading calendar arrives in Phase 2.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Wall-clock components of `date` as seen in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (e.g. +330 for Asia/Kolkata). */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Exchange-local calendar date ("YYYY-MM-DD") for an instant. */
export function toZonedDateString(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Convert an exchange-local wall-clock time to a UTC instant.
 * `localDate` is "YYYY-MM-DD", `localTime` is "HH:mm".
 */
export function zonedLocalToUtc(localDate: string, localTime: string, timeZone: string): Date {
  const [y, m, d] = parseDate(localDate);
  const [hh, mm] = parseTime(localTime);
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle DST transitions correctly for regular trading hours.
  let offset = getTimeZoneOffsetMinutes(new Date(naiveUtc), timeZone);
  let result = naiveUtc - offset * 60000;
  const offset2 = getTimeZoneOffsetMinutes(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = naiveUtc - offset * 60000;
  }
  return new Date(result);
}

/** Weekday (0=Sun) of a "YYYY-MM-DD" calendar date. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = parseDate(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = parseDate(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isWeekend(dateStr: string): boolean {
  const wd = weekdayOf(dateStr);
  return wd === 0 || wd === 6;
}

/** All weekdays between two dates inclusive (holidays not excluded — see module note). */
export function weekdaysBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    if (!isWeekend(d)) out.push(d);
  }
  return out;
}

export interface SessionConfig {
  timezone: string;
  openTime: string; // "HH:mm" local
  closeTime: string; // "HH:mm" local
}

export type SessionState = "OPEN" | "PRE_OPEN" | "CLOSED" | "WEEKEND";

export interface SessionStatus {
  state: SessionState;
  localDate: string;
  localTime: string; // "HH:mm"
  label: string;
}

/** Regular-session status of an exchange at `now` (weekends only; holidays not modelled). */
export function getSessionStatus(market: SessionConfig, now: Date = new Date()): SessionStatus {
  const p = getZonedParts(now, market.timezone);
  const localDate = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const localTime = `${pad(p.hour)}:${pad(p.minute)}`;
  const minutes = p.hour * 60 + p.minute;
  const [oh, om] = parseTime(market.openTime);
  const [ch, cm] = parseTime(market.closeTime);
  const open = oh * 60 + om;
  const close = ch * 60 + cm;

  if (p.weekday === 0 || p.weekday === 6) {
    return { state: "WEEKEND", localDate, localTime, label: "Closed (weekend)" };
  }
  if (minutes < open) {
    return { state: "PRE_OPEN", localDate, localTime, label: `Opens ${market.openTime}` };
  }
  if (minutes < close) {
    return { state: "OPEN", localDate, localTime, label: `Open until ${market.closeTime}` };
  }
  return { state: "CLOSED", localDate, localTime, label: `Closed at ${market.closeTime}` };
}

/**
 * Most recent exchange-local date whose regular session has fully closed at `now`
 * (weekdays only).
 */
export function lastCompletedSessionDate(market: SessionConfig, now: Date = new Date()): string {
  const status = getSessionStatus(market, now);
  let d = status.state === "CLOSED" ? status.localDate : addDays(status.localDate, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseDate(s: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid date string: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseTime(s: string): [number, number] {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid time string: ${s}`);
  return [Number(m[1]), Number(m[2])];
}
