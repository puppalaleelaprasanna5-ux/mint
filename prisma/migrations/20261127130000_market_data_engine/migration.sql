-- DropIndex
DROP INDEX "PriceBar_instrumentId_interval_timestamp_key";

-- DropIndex
DROP INDEX "PriceBar_instrumentId_interval_tradingDate_idx";

-- CreateTable
CREATE TABLE "InstrumentProviderSymbol" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSymbol" TEXT NOT NULL,
    "verifiedFrom" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstrumentProviderSymbol_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketDataSync" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "instrumentId" TEXT,
    "interval" TEXT NOT NULL,
    "source" TEXT,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketDataSync_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentProviderSymbol_provider_instrumentId_key" ON "InstrumentProviderSymbol"("provider", "instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentProviderSymbol_provider_providerSymbol_key" ON "InstrumentProviderSymbol"("provider", "providerSymbol");

-- CreateIndex
CREATE INDEX "MarketDataSync_provider_startedAt_idx" ON "MarketDataSync"("provider", "startedAt");

-- CreateIndex
CREATE INDEX "MarketDataSync_instrumentId_startedAt_idx" ON "MarketDataSync"("instrumentId", "startedAt");

-- CreateIndex
CREATE INDEX "PriceBar_instrumentId_interval_isSimulated_tradingDate_idx" ON "PriceBar"("instrumentId", "interval", "isSimulated", "tradingDate");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_instrumentId_interval_source_timestamp_key" ON "PriceBar"("instrumentId", "interval", "source", "timestamp");
