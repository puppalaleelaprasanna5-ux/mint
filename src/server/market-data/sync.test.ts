/**
 * Integration test: runs the sync service against a temporary SQLite database created from the
 * real Prisma migrations, with fake providers (no network).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createPrismaClient } from "@/server/prisma-factory";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  ProviderError,
  type DailyBarsRequest,
  type DailyBarsResult,
  type MarketDataProvider,
  type ProviderId,
  type ProviderInstrumentRef,
} from "@/lib/market-data/types";
import { syncDailyBars } from "./sync";

let dir: string;
let db: PrismaClient;
let nseId: string;
let relianceId: string;
let niftyId: string;

class FakeProvider implements MarketDataProvider {
  readonly name: string;
  readonly regions: ("IN" | "US")[] = ["IN"];
  calls: DailyBarsRequest[] = [];
  constructor(
    readonly id: ProviderId,
    private readonly impl: (req: DailyBarsRequest) => Promise<DailyBarsResult>,
    private readonly configured = true,
  ) {
    this.name = id;
  }
  status() {
    return {
      id: this.id,
      name: this.name,
      regions: this.regions,
      configured: this.configured,
      missingEnv: this.configured ? [] : ["X_TOKEN"],
      source: this.id,
      notes: [],
    };
  }
  supports(i: ProviderInstrumentRef) {
    return i.providerSymbol !== "UNSUPPORTED";
  }
  async fetchDailyBars(req: DailyBarsRequest) {
    this.calls.push(req);
    return this.impl(req);
  }
}

const bars = (dates: string[], close = 100) =>
  dates.map((d, i) => ({ tradingDate: d, open: close + i, high: close + i + 2, low: close + i - 2, close: close + i + 1, volume: 1000 + i }));

const NOW = new Date("2026-11-27T12:00:00Z"); // Fri 17:30 IST → last completed NSE session 2026-11-27
const opts = { now: NOW, requestDelayMs: 0, lookbackDays: 10 };

const providers = (upstox: MarketDataProvider, alpaca?: MarketDataProvider) =>
  ({ upstox, alpaca: alpaca ?? new FakeProvider("alpaca", async () => ({ source: "a", currency: "USD", bars: [], unparseable: 0, notes: [] }), false) }) as Record<ProviderId, MarketDataProvider>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mint-sync-test-"));
  const file = join(dir, "test.db");
  const raw = new Database(file);
  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  for (const m of readdirSync(migrationsDir).filter((d) => /^\d+_/.test(d)).sort()) {
    raw.exec(readFileSync(join(migrationsDir, m, "migration.sql"), "utf8"));
  }
  raw.close();
  db = createPrismaClient(`file:${file}`);
  const market = await db.market.create({
    data: { code: "NSE", mic: "XNSE", name: "NSE", region: "IN", countryCode: "IN", timezone: "Asia/Kolkata", currency: "INR", openTime: "09:15", closeTime: "15:30" },
  });
  nseId = market.id;
  relianceId = (await db.instrument.create({ data: { marketId: nseId, symbol: "RELIANCE", name: "Reliance", type: "EQUITY", currency: "INR" } })).id;
  niftyId = (await db.instrument.create({ data: { marketId: nseId, symbol: "NIFTY50", name: "Nifty", type: "INDEX", currency: "INR" } })).id;
  await db.instrumentProviderSymbol.createMany({
    data: [
      { instrumentId: relianceId, provider: "upstox", providerSymbol: "NSE_EQ|INE002A01018" },
      { instrumentId: niftyId, provider: "upstox", providerSymbol: "NSE_INDEX|Nifty 50" },
    ],
  });
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.priceBar.deleteMany();
  await db.marketDataSync.deleteMany();
});

describe("syncDailyBars", () => {
  it("does not call unconfigured providers", async () => {
    const upstox = new FakeProvider("upstox", async () => { throw new Error("should not be called"); }, false);
    const report = await syncDailyBars(db, providers(upstox), opts);
    expect(upstox.calls).toHaveLength(0);
    expect(report.items).toHaveLength(0);
    expect(report.providers[0]).toMatchObject({ id: "upstox", configured: false, missingEnv: ["X_TOKEN"] });
  });

  it("requests only completed sessions and inserts validated bars as non-simulated", async () => {
    const upstox = new FakeProvider("upstox", async () => ({
      source: "upstox",
      currency: "INR",
      bars: bars(["2026-11-25", "2026-11-26", "2026-11-27"]),
      unparseable: 0,
      notes: [],
    }));
    const report = await syncDailyBars(db, providers(upstox), { ...opts, symbols: ["RELIANCE"] });
    expect(upstox.calls[0]).toMatchObject({ fromDate: "2026-11-17", toDate: "2026-11-27" });
    expect(report.items[0]).toMatchObject({ status: "SUCCESS", inserted: 3, updated: 0, unchanged: 0, rejected: 0 });

    const stored = await db.priceBar.findMany({ where: { instrumentId: relianceId }, orderBy: { tradingDate: "asc" } });
    expect(stored.map((b) => [b.tradingDate, b.source, b.isSimulated])).toEqual([
      ["2026-11-25", "upstox", false],
      ["2026-11-26", "upstox", false],
      ["2026-11-27", "upstox", false],
    ]);
    // Timestamp = session open in exchange time (09:15 IST = 03:45 UTC)
    expect(stored[0].timestamp.toISOString()).toBe("2026-11-25T03:45:00.000Z");
    expect(await db.marketDataSync.count({ where: { status: "SUCCESS" } })).toBe(1);
  });

  it("is idempotent and updates corrected bars instead of duplicating", async () => {
    let close = 100;
    const upstox = new FakeProvider("upstox", async () => ({
      source: "upstox",
      currency: "INR",
      bars: bars(["2026-11-25", "2026-11-26"], close),
      unparseable: 0,
      notes: [],
    }));
    await syncDailyBars(db, providers(upstox), { ...opts, symbols: ["RELIANCE"] });
    const second = await syncDailyBars(db, providers(upstox), { ...opts, symbols: ["RELIANCE"] });
    expect(second.items[0]).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    close = 200; // provider revises its data
    const third = await syncDailyBars(db, providers(upstox), { ...opts, symbols: ["RELIANCE"] });
    expect(third.items[0]).toMatchObject({ inserted: 0, updated: 2, unchanged: 0 });
    expect(await db.priceBar.count({ where: { instrumentId: relianceId } })).toBe(2);
  });

  it("keeps simulated bars alongside provider bars for the same session", async () => {
    await db.priceBar.create({
      data: {
        instrumentId: relianceId, interval: "ONE_DAY", timestamp: new Date("2026-11-26T03:45:00Z"), tradingDate: "2026-11-26",
        open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, source: "mint-demo-generator", isSimulated: true,
      },
    });
    const upstox = new FakeProvider("upstox", async () => ({ source: "upstox", currency: "INR", bars: bars(["2026-11-26"]), unparseable: 0, notes: [] }));
    await syncDailyBars(db, providers(upstox), { ...opts, symbols: ["RELIANCE"] });
    const rows = await db.priceBar.findMany({ where: { instrumentId: relianceId, tradingDate: "2026-11-26" } });
    expect(rows.map((r) => r.source).sort()).toEqual(["mint-demo-generator", "upstox"]);
  });

  it("stores valid bars, rejects invalid ones and reports PARTIAL", async () => {
    const bad = { tradingDate: "2026-11-26", open: 100, high: 90, low: 95, close: 99, volume: 10 };
    const weekend = { ...bars(["2026-11-22"])[0] };
    const upstox = new FakeProvider("upstox", async () => ({
      source: "upstox",
      currency: "INR",
      bars: [...bars(["2026-11-25"]), bad, weekend],
      unparseable: 1,
      notes: [],
    }));
    const r = await syncDailyBars(db, providers(upstox), { ...opts, symbols: ["RELIANCE"] });
    expect(r.items[0]).toMatchObject({ status: "PARTIAL", inserted: 1, rejected: 3, received: 4 });
    expect(r.items[0].message).toMatch(/weekend/);
    expect(r.items[0].message).toMatch(/high is below/);
  });

  it("allows zero volume for indices only", async () => {
    const upstox = new FakeProvider("upstox", async () => ({
      source: "upstox",
      currency: "INR",
      bars: bars(["2026-11-26"]).map((b) => ({ ...b, volume: 0 })),
      unparseable: 0,
      notes: [],
    }));
    const r = await syncDailyBars(db, providers(upstox), opts);
    const bySymbol = Object.fromEntries(r.items.map((i) => [i.symbol, i.status]));
    expect(bySymbol).toEqual({ NIFTY50: "SUCCESS", RELIANCE: "FAILED" });
  });

  it("fails the batch on currency mismatch and stores nothing", async () => {
    const upstox = new FakeProvider("upstox", async () => ({ source: "upstox", currency: "USD", bars: bars(["2026-11-26"]), unparseable: 0, notes: [] }));
    const r = await syncDailyBars(db, providers(upstox), { ...opts, symbols: ["RELIANCE"] });
    expect(r.items[0].status).toBe("FAILED");
    expect(r.items[0].message).toMatch(/Currency mismatch/);
    expect(await db.priceBar.count()).toBe(0);
  });

  it("stops calling a provider after an authorization error and logs the rest as SKIPPED", async () => {
    const upstox = new FakeProvider("upstox", async () => {
      throw new ProviderError("upstox", "UNAUTHORIZED", "token expired", 401);
    });
    const r = await syncDailyBars(db, providers(upstox), opts);
    expect(upstox.calls).toHaveLength(1);
    expect(r.items.map((i) => i.status)).toEqual(["FAILED", "SKIPPED"]);
    expect(r.items[1].message).toMatch(/Skipped: upstox unauthorized/);
    expect(await db.marketDataSync.count()).toBe(2);
  });

  it("marks an empty response for a multi-week range as FAILED", async () => {
    const upstox = new FakeProvider("upstox", async () => ({ source: "upstox", currency: "INR", bars: [], unparseable: 0, notes: [] }));
    const r = await syncDailyBars(db, providers(upstox), { ...opts, symbols: ["RELIANCE"] });
    expect(r.items[0].status).toBe("FAILED");
    expect(r.items[0].message).toMatch(/no bars .*(9 weekdays requested)/);
  });

  it("continues after a non-fatal error on one instrument", async () => {
    const upstox = new FakeProvider("upstox", async (req) => {
      if (req.instrument.symbol === "NIFTY50") throw new ProviderError("upstox", "NOT_FOUND", "unknown key", 404);
      return { source: "upstox", currency: "INR", bars: bars(["2026-11-26"]), unparseable: 0, notes: [] };
    });
    const r = await syncDailyBars(db, providers(upstox), opts);
    expect(r.items.map((i) => [i.symbol, i.status])).toEqual([
      ["NIFTY50", "FAILED"],
      ["RELIANCE", "SUCCESS"],
    ]);
  });
});
