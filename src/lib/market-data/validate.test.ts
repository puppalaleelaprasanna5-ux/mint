import { describe, expect, it } from "vitest";
import { validateBar, validateDailyBars, type ValidationContext } from "./validate";
import type { NormalizedDailyBar } from "./types";

const ctx: ValidationContext = {
  expectedCurrency: "INR",
  providerCurrency: "INR",
  lastCompletedDate: "2026-11-27",
  allowZeroVolume: false,
};

const bar = (over: Partial<NormalizedDailyBar> = {}): NormalizedDailyBar => ({
  tradingDate: "2026-11-26",
  open: 100,
  high: 105,
  low: 98,
  close: 103,
  volume: 1000,
  ...over,
});

describe("validateBar", () => {
  it("accepts a well-formed bar", () => {
    expect(validateBar(bar(), ctx)).toEqual([]);
  });

  it("rejects inconsistent OHLC", () => {
    expect(validateBar(bar({ high: 99 }), ctx)).toContain("high is below open/close");
    expect(validateBar(bar({ low: 101 }), ctx)).toContain("low is above open/close");
    expect(validateBar(bar({ high: 90, low: 95, open: 92, close: 93 }), ctx)).toContain("high is below low");
  });

  it("rejects non-finite, zero and negative prices", () => {
    expect(validateBar(bar({ close: Number.NaN }), ctx)).toContain("close is not a finite number");
    expect(validateBar(bar({ open: 0 }), ctx)).toContain("open must be positive");
    expect(validateBar(bar({ low: -1 }), ctx)).toContain("low must be positive");
  });

  it("checks volume, allowing zero only for indices", () => {
    expect(validateBar(bar({ volume: -5 }), ctx)).toContain("volume is negative");
    expect(validateBar(bar({ volume: 0 }), ctx)).toContain("volume is zero for a traded instrument");
    expect(validateBar(bar({ volume: 0 }), { ...ctx, allowZeroVolume: true })).toEqual([]);
    expect(validateBar(bar({ volume: Number.POSITIVE_INFINITY }), ctx)).toContain("volume is not a finite number");
  });

  it("rejects malformed, impossible, weekend and incomplete-session dates", () => {
    expect(validateBar(bar({ tradingDate: "26/11/2026" }), ctx)[0]).toMatch(/invalid trading date/);
    expect(validateBar(bar({ tradingDate: "2026-02-30" }), ctx)[0]).toMatch(/invalid trading date/);
    expect(validateBar(bar({ tradingDate: "2026-11-28" }), ctx)).toContain("trading date falls on a weekend");
    expect(validateBar(bar({ tradingDate: "2026-11-30" }), ctx)).toContain("session has not completed yet");
  });
});

describe("validateDailyBars", () => {
  it("sorts oldest → newest and keeps valid bars", () => {
    const r = validateDailyBars([bar({ tradingDate: "2026-11-26" }), bar({ tradingDate: "2026-11-24" })], ctx);
    expect(r.valid.map((b) => b.tradingDate)).toEqual(["2026-11-24", "2026-11-26"]);
    expect(r.rejected).toEqual([]);
    expect(r.batchError).toBeNull();
  });

  it("rejects duplicate trading dates within a batch", () => {
    const r = validateDailyBars([bar(), bar({ close: 104, high: 106 })], ctx);
    expect(r.valid).toHaveLength(1);
    expect(r.rejected[0].reasons).toContain("duplicate trading date in response");
  });

  it("rejects the whole batch on currency mismatch", () => {
    const r = validateDailyBars([bar()], { ...ctx, providerCurrency: "USD" });
    expect(r.valid).toEqual([]);
    expect(r.batchError).toMatch(/Currency mismatch/);
  });

  it("matches currencies case-insensitively", () => {
    expect(validateDailyBars([bar()], { ...ctx, providerCurrency: "inr" }).batchError).toBeNull();
  });

  it("warns (but keeps) large close-to-close jumps", () => {
    const r = validateDailyBars(
      [bar({ tradingDate: "2026-11-25" }), bar({ tradingDate: "2026-11-26", open: 50, high: 52, low: 49, close: 51 })],
      ctx,
    );
    expect(r.valid).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/2026-11-26: close moved -50\.5%/);
  });

  it("keeps good bars and reports bad ones in a mixed batch", () => {
    const r = validateDailyBars([bar({ tradingDate: "2026-11-25" }), bar({ tradingDate: "2026-11-26", high: 1 })], ctx);
    expect(r.valid.map((b) => b.tradingDate)).toEqual(["2026-11-25"]);
    expect(r.rejected.map((b) => b.tradingDate)).toEqual(["2026-11-26"]);
  });
});
