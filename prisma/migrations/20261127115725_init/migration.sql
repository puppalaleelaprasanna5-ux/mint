-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "mic" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "isin" TEXT,
    "sector" TEXT,
    "industry" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Instrument_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceBar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "tradingDate" TEXT NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "adjClose" REAL,
    "volume" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "isSimulated" BOOLEAN NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceBar_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "lastEvaluatedAt" DATETIME,
    "triggeredAt" DATETIME,
    "triggeredValue" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Alert_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "alertId" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "cashBalance" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "averageCost" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Holding_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Holding_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "price" DECIMAL NOT NULL,
    "fees" DECIMAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "executedAt" DATETIME NOT NULL,
    "note" TEXT,
    "paperOrderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_paperOrderId_fkey" FOREIGN KEY ("paperOrderId") REFERENCES "PaperOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "limitPrice" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filledPrice" DECIMAL,
    "filledAt" DATETIME,
    "rejectReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperOrder_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperOrder_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "publisher" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "region" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NewsArticleInstrument" (
    "articleId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,

    PRIMARY KEY ("articleId", "instrumentId"),
    CONSTRAINT "NewsArticleInstrument_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NewsArticleInstrument_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsSentiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "modelVersionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsSentiment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NewsSentiment_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NewsSentiment_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "featureSet" TEXT,
    "metrics" TEXT,
    "trainStart" DATETIME,
    "trainEnd" DATETIME,
    "testStart" DATETIME,
    "testEnd" DATETIME,
    "trainedAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "asOf" DATETIME NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "predictedClass" TEXT,
    "probability" REAL,
    "predictedValue" REAL,
    "lowerBound" REAL,
    "upperBound" REAL,
    "explanation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Prediction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prediction_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_code_key" ON "Market"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Market_mic_key" ON "Market"("mic");

-- CreateIndex
CREATE INDEX "Market_region_idx" ON "Market"("region");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_isin_key" ON "Instrument"("isin");

-- CreateIndex
CREATE INDEX "Instrument_symbol_idx" ON "Instrument"("symbol");

-- CreateIndex
CREATE INDEX "Instrument_name_idx" ON "Instrument"("name");

-- CreateIndex
CREATE INDEX "Instrument_type_idx" ON "Instrument"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_marketId_symbol_key" ON "Instrument"("marketId", "symbol");

-- CreateIndex
CREATE INDEX "PriceBar_instrumentId_interval_tradingDate_idx" ON "PriceBar"("instrumentId", "interval", "tradingDate");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_instrumentId_interval_timestamp_key" ON "PriceBar"("instrumentId", "interval", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_name_key" ON "Watchlist"("name");

-- CreateIndex
CREATE INDEX "WatchlistItem_instrumentId_idx" ON "WatchlistItem"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_instrumentId_key" ON "WatchlistItem"("watchlistId", "instrumentId");

-- CreateIndex
CREATE INDEX "Alert_status_idx" ON "Alert"("status");

-- CreateIndex
CREATE INDEX "Alert_instrumentId_idx" ON "Alert"("instrumentId");

-- CreateIndex
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_name_key" ON "Portfolio"("name");

-- CreateIndex
CREATE INDEX "Holding_instrumentId_idx" ON "Holding"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_portfolioId_instrumentId_key" ON "Holding"("portfolioId", "instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_paperOrderId_key" ON "Transaction"("paperOrderId");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_executedAt_idx" ON "Transaction"("portfolioId", "executedAt");

-- CreateIndex
CREATE INDEX "Transaction_instrumentId_idx" ON "Transaction"("instrumentId");

-- CreateIndex
CREATE INDEX "PaperOrder_portfolioId_status_idx" ON "PaperOrder"("portfolioId", "status");

-- CreateIndex
CREATE INDEX "PaperOrder_instrumentId_idx" ON "PaperOrder"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_url_key" ON "NewsArticle"("url");

-- CreateIndex
CREATE INDEX "NewsArticle_publishedAt_idx" ON "NewsArticle"("publishedAt");

-- CreateIndex
CREATE INDEX "NewsArticleInstrument_instrumentId_idx" ON "NewsArticleInstrument"("instrumentId");

-- CreateIndex
CREATE INDEX "NewsSentiment_instrumentId_idx" ON "NewsSentiment"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsSentiment_articleId_instrumentId_modelVersionId_key" ON "NewsSentiment"("articleId", "instrumentId", "modelVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_name_version_key" ON "ModelVersion"("name", "version");

-- CreateIndex
CREATE INDEX "Prediction_asOf_idx" ON "Prediction"("asOf");

-- CreateIndex
CREATE UNIQUE INDEX "Prediction_instrumentId_modelVersionId_asOf_horizonDays_key" ON "Prediction"("instrumentId", "modelVersionId", "asOf", "horizonDays");
