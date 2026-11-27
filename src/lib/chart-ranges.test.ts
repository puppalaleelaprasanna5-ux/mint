import { describe, expect, it } from "vitest";
import { describeSpan, selectRange, subtractMonths } from "./chart-ranges";
import { weekdaysBetween } from "./time";

const series = (from: string, to: string) => weekdaysBetween(from, to).map((time) => ({ time }));

describe("subtractMonths", () => {
  it("handles month and year boundaries", () => {
    expect(subtractMonths("2026-11-27", 1)).toBe("2026-10-27");
    expect(subtractMonths("2026-02-15", 3)).toBe("2025-11-15");
    expect(subtractMonths("2026-11-27", 60)).toBe("2021-11-27");
  });

  it("clamps to the end of shorter months", () => {
    expect(subtractMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(subtractMonths("2024-03-31", 1)).toBe("2024-02-29"); // leap year
    expect(subtractMonths("2026-12-31", 6)).toBe("2026-06-30");
  });
});

describe("selectRange", () => {
  const bars = series("2025-05-19", "2026-11-27"); // ~1.5 years, like the seeded data

  it("selects bars within the range, counted from the last bar", () => {
    const r = selectRange(bars, "1M");
    expect(r.bars[0].time).toBe("2026-10-27");
    expect(r.bars.at(-1)?.time).toBe("2026-11-27");
    expect(r.partial).toBe(false);
  });

  it("covers a full year without being partial", () => {
    const r = selectRange(bars, "1Y");
    expect(r.requestedFrom).toBe("2025-11-27");
    expect(r.bars[0].time).toBe("2025-11-27");
    expect(r.partial).toBe(false);
  });

  it("returns all available bars and flags partial coverage when history is shorter", () => {
    const r = selectRange(bars, "5Y");
    expect(r.bars).toHaveLength(bars.length);
    expect(r.requestedFrom).toBe("2021-11-27");
    expect(r.partial).toBe(true);
  });

  it("is calendar-based, so gaps in data do not widen the window", () => {
    const gappy = [...series("2026-01-01", "2026-06-30"), ...series("2026-11-02", "2026-11-27")];
    const r = selectRange(gappy, "3M");
    expect(r.bars[0].time).toBe("2026-11-02"); // nothing between Jul and Oct is pulled in
    expect(r.partial).toBe(false);
  });

  it("handles empty and single-bar series", () => {
    expect(selectRange([], "1Y")).toEqual({ bars: [], requestedFrom: null, partial: false });
    const one = selectRange([{ time: "2026-11-27" }], "6M");
    expect(one.bars).toHaveLength(1);
    expect(one.partial).toBe(true);
  });
});

describe("describeSpan", () => {
  it("describes spans in friendly units", () => {
    expect(describeSpan("2026-11-27", "2026-11-27")).toBe("0 days");
    expect(describeSpan("2026-11-20", "2026-11-27")).toBe("7 days");
    expect(describeSpan("2026-10-30", "2026-11-27")).toBe("4 weeks");
    expect(describeSpan("2026-05-27", "2026-11-27")).toBe("6 months");
    expect(describeSpan("2025-05-19", "2026-11-27")).toBe("1 year 6 months");
    expect(describeSpan("2021-11-27", "2026-11-27")).toBe("5 years");
  });
});
