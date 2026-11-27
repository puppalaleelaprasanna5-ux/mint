import { describe, expect, it } from "vitest";
import {
  addDays,
  getSessionStatus,
  getTimeZoneOffsetMinutes,
  isWeekend,
  lastCompletedSessionDate,
  toZonedDateString,
  weekdaysBetween,
  zonedLocalToUtc,
} from "./time";

const NSE = { timezone: "Asia/Kolkata", openTime: "09:15", closeTime: "15:30" };
const NYSE = { timezone: "America/New_York", openTime: "09:30", closeTime: "16:00" };

describe("time zone conversion", () => {
  it("converts IST wall-clock to UTC (+05:30, no DST)", () => {
    expect(zonedLocalToUtc("2026-06-01", "09:15", "Asia/Kolkata").toISOString()).toBe("2026-06-01T03:45:00.000Z");
    expect(zonedLocalToUtc("2026-12-01", "15:30", "Asia/Kolkata").toISOString()).toBe("2026-12-01T10:00:00.000Z");
  });

  it("handles US daylight saving time", () => {
    // EDT (UTC-4) in summer, EST (UTC-5) in winter
    expect(zonedLocalToUtc("2026-07-15", "09:30", "America/New_York").toISOString()).toBe("2026-07-15T13:30:00.000Z");
    expect(zonedLocalToUtc("2026-01-15", "09:30", "America/New_York").toISOString()).toBe("2026-01-15T14:30:00.000Z");
    // Days either side of the 2026 transitions (Mar 8 and Nov 1)
    expect(zonedLocalToUtc("2026-03-06", "16:00", "America/New_York").toISOString()).toBe("2026-03-06T21:00:00.000Z");
    expect(zonedLocalToUtc("2026-03-09", "16:00", "America/New_York").toISOString()).toBe("2026-03-09T20:00:00.000Z");
    expect(zonedLocalToUtc("2026-11-02", "09:30", "America/New_York").toISOString()).toBe("2026-11-02T14:30:00.000Z");
  });

  it("reports offsets in minutes", () => {
    expect(getTimeZoneOffsetMinutes(new Date("2026-01-01T00:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(getTimeZoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
  });

  it("derives exchange-local calendar dates", () => {
    // 20:00 UTC on Jan 5 is already Jan 6 in India
    expect(toZonedDateString(new Date("2026-01-05T20:00:00Z"), "Asia/Kolkata")).toBe("2026-01-06");
    expect(toZonedDateString(new Date("2026-01-05T20:00:00Z"), "America/New_York")).toBe("2026-01-05");
  });
});

describe("calendar helpers", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("identifies weekends and lists weekdays", () => {
    expect(isWeekend("2026-11-28")).toBe(true); // Saturday
    expect(isWeekend("2026-11-27")).toBe(false); // Friday
    expect(weekdaysBetween("2026-11-27", "2026-12-02")).toEqual(["2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02"]);
  });
});

describe("session status", () => {
  it("is OPEN during NSE hours", () => {
    const s = getSessionStatus(NSE, new Date("2026-11-27T05:00:00Z")); // 10:30 IST Friday
    expect(s.state).toBe("OPEN");
    expect(s.localTime).toBe("10:30");
  });

  it("is PRE_OPEN before and CLOSED after the session", () => {
    expect(getSessionStatus(NSE, new Date("2026-11-27T03:00:00Z")).state).toBe("PRE_OPEN"); // 08:30 IST
    expect(getSessionStatus(NSE, new Date("2026-11-27T10:00:00Z")).state).toBe("CLOSED"); // 15:30 IST exactly
  });

  it("is WEEKEND on Saturday local time even when UTC is Friday", () => {
    // Fri 20:00 UTC = Sat 01:30 IST
    expect(getSessionStatus(NSE, new Date("2026-11-27T20:00:00Z")).state).toBe("WEEKEND");
    expect(getSessionStatus(NYSE, new Date("2026-11-27T20:00:00Z")).state).toBe("OPEN"); // 15:00 EST Fri
  });

  it("finds the last completed session", () => {
    // Friday 10:30 IST → Thursday
    expect(lastCompletedSessionDate(NSE, new Date("2026-11-27T05:00:00Z"))).toBe("2026-11-26");
    // Friday 16:00 IST → Friday
    expect(lastCompletedSessionDate(NSE, new Date("2026-11-27T10:30:00Z"))).toBe("2026-11-27");
    // Monday 08:00 IST → previous Friday
    expect(lastCompletedSessionDate(NSE, new Date("2026-11-30T02:30:00Z"))).toBe("2026-11-27");
  });
});
