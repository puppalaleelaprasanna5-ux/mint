# Mint

A personal, AI-assisted stock research workspace for **Indian (NSE/BSE)** and **US (NASDAQ/NYSE)** markets.
Built for one user who is learning to invest: every screen explains what it shows in plain language.

> **Current status: Phase 2A (market data engine).** Mint can load **end-of-day historical prices** from
> Upstox (India) and Alpaca (US stocks) once you add your own credentials. Until then, and for anything a
> provider cannot supply, prices are **simulated** and labelled SIMULATED everywhere. Nothing is live, and
> nothing in Mint is investment advice.

## What works today

| Area | Status |
| --- | --- |
| Dashboard | India and US overviews (NIFTY 50, SENSEX, NASDAQ Composite, S&P 500), exchange open/closed status, index performance chart, watchlist, market filter (All / India / US) |
| Explore Stocks | Search by symbol or name, filter by market and type, instrument page with candlestick + volume chart, key numbers, watchlist and alert controls |
| Watchlists | Create, delete, set default, add and remove instruments |
| Smart Alerts | Price-above / price-below alerts: create, pause, resume, re-arm, delete; **Check now** evaluates them against the latest stored close and records triggers |
| Market data | Upstox + Alpaca daily-history adapters, validation, duplicate-safe storage, sync audit log, simulated fallback, `npm run data:sync` and a **Sync daily history** button |
| Settings | Provider status (which env vars are missing), coverage, sync log, stored data by source, exchange time zones / currencies / hours |
| AI Analysis, Market News, My Portfolio, Paper Trading | Planned for Phases 3–6. These pages say "Not built yet", contain no fake data or dead buttons, and include beginner explainers |

## Requirements

- Node.js **20.19+** (developed on Node 24) and npm
- No API keys are needed for Phase 1

## Getting started

```bash
npm install                 # also generates the Prisma client (postinstall)
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run db:setup            # apply migrations, generate client, seed simulated data
npm run dev                 # http://localhost:3000
```

Production build:

```bash
npm run build
npm start
```

## Connecting real market data (optional)

Both providers are free to start with. Put credentials in `.env`. They stay server-side; never commit `.env`.

| Variable | Where to get it |
| --- | --- |
| `UPSTOX_ACCESS_TOKEN` | Upstox Developer Apps → **Analytics** tab → Generate Token. Free, read-only, valid 1 year ([docs](https://upstox.com/developer/api-documentation/analytics-token/)). A daily OAuth access token also works but expires every day. |
| `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` | Alpaca dashboard → API Keys. Only market-data endpoints are called. |
| `ALPACA_DATA_FEED` | `iex` (default; Alpaca documents it as usable without a subscription; volume = IEX trades only) or `sip` (full-market volume; only if your plan allows SIP history). |

Then restart the server and run `npm run data:sync`, or press **Sync daily history** in Settings. It fetches
about 2 years of completed daily sessions. Re-running is safe: unchanged bars are skipped and corrected bars
are updated.

How the data is handled:

- **One source per instrument.** If an instrument has provider bars, Mint shows only those; otherwise it
  shows its simulated series. Real and simulated prices are never spliced into one chart. Simulated bars are
  kept as the fallback.
- **Validation.** Bars are rejected for non-positive or non-finite prices, inconsistent OHLC, negative volume
  (zero is allowed only for indices), malformed, weekend or not-yet-completed dates, and duplicates. A
  currency mismatch rejects the whole batch. Moves larger than 40% are kept but flagged as a possible split.
- **Refusals are respected.** A 401, 403 or 429 stops further calls to that provider for the run and is
  logged. Mint never retries on a different feed or without credentials.
- **Audit.** Every request is recorded in `MarketDataSync` (range, counts, status, message) and shown in
  Settings.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | Generate Next.js route types, then `tsc --noEmit` (strict mode) |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm test` | Vitest unit tests |
| `npm run check` | typecheck + lint + tests |
| `npm run db:setup` | `migrate deploy` + `generate` + seed (first-time setup) |
| `npm run db:migrate` | Create/apply a migration after editing `prisma/schema.prisma` |
| `npm run db:seed` | Re-seed. Safe to re-run: replaces only simulated price bars; your watchlists and alerts are kept |
| `npm run db:reset` | **Deletes all data**, re-applies migrations and re-seeds |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run data:sync` | Fetch daily history from configured providers. Options: `-- --provider=upstox`, `-- --symbols=RELIANCE,AAPL`, `-- --days=365` |

## Architecture

```
prisma/
  schema.prisma          15 domain models + news↔instrument join table
  migrations/            SQL migrations
  seed.ts                markets, instruments, simulated daily bars, starter watchlist
src/
  app/                   Next.js App Router pages and /api route handlers
  components/            UI (layout, dashboard, explore, alerts, charts)
  lib/                   Pure, unit-tested logic: time zones & sessions, formatting,
                         quote math, search ranking, alert rules, Zod schemas, demo generator
  lib/market-data/       Provider contracts, bar validation, provider symbol mappings
  server/market-data/    Upstox + Alpaca adapters, provider registry, sync service (also used by the CLI)
  server/                Server-only code
    db.ts                Prisma client (SQLite via better-sqlite3 driver adapter)
    http.ts              route wrapper: JSON errors, Zod/Prisma error mapping
    services/            markets, instruments, prices, watchlists, alerts
  generated/prisma/      Generated Prisma client (git-ignored)
```

- **Service boundary.** Route handlers validate input with Zod and call `src/server/services/*`. Pages
  call the same services directly. A future Python FastAPI service (Phase 4) can sit behind new services
  without UI changes.
- **Data provenance.** Every `PriceBar` stores `source`, `isSimulated`, `tradingDate` (exchange-local)
  and `fetchedAt`. Every price in the UI shows a freshness line, and simulated data always carries an amber
  **SIMULATED** badge.
- **Time zones.** Timestamps are stored in UTC. Exchange-local dates and session status are derived from
  each `Market.timezone` (IANA), with DST handled correctly (unit-tested).
- **Money.** Ledger values (transactions, holdings, paper orders) use `Decimal`. Analytical OHLCV uses
  `Float`. Currencies are ISO 4217 codes stored per market and per instrument.
- **Next.js 16 Cache Components.** The SQLite driver is synchronous, so all data reads run after
  `connection()` inside `<Suspense>`. API routes are never prerendered with stale data.

## API

All responses are `{ "data": ... }` or `{ "error": { "code", "message", "details?" } }`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | DB status, row counts, data mode (`simulated` / `provider` / `mixed` / `empty`) |
| GET | `/api/markets` | Exchanges with time zone, currency, hours, current session state |
| GET | `/api/overview?region=ALL\|IN\|US` | Benchmark index quotes + 30-session sparkline per region |
| GET | `/api/instruments?q=&region=&type=&limit=` | Ranked search with latest quotes |
| GET | `/api/instruments/:id` | Instrument + latest quote |
| GET | `/api/instruments/:id/bars?interval=1d&from=&to=&limit=` | Daily OHLCV history with provenance |
| GET, POST | `/api/watchlists` | List / create (`{ name }`) |
| GET, PATCH, DELETE | `/api/watchlists/:id` | Get with quotes / rename or `{ isDefault: true }` / delete |
| POST | `/api/watchlists/:id/items` | Add `{ instrumentId, note? }` |
| DELETE | `/api/watchlists/:id/items/:instrumentId` | Remove |
| GET, POST | `/api/alerts` | List (`?instrumentId=`) / create `{ instrumentId, type: PRICE_ABOVE\|PRICE_BELOW, threshold, note? }` |
| PATCH, DELETE | `/api/alerts/:id` | `{ status: ACTIVE\|PAUSED, threshold?, note? }` (ACTIVE re-arms) / delete |
| POST | `/api/alerts/evaluate` | Check active price alerts against the latest stored close |
| GET | `/api/notifications` | Recent alert-trigger notifications |
| GET | `/api/market-data/status` | Provider configuration (env var names only, never values), coverage, recent sync log |
| POST | `/api/market-data/sync` | `{ providers?, symbols?, lookbackDays? }`. Syncs configured providers; one run at a time |

## Known limitations

- **Simulated fallback.** Without credentials every price is simulated, and simulated levels drift away from
  real-world values. **Never use SIMULATED numbers for decisions.**
- **US indices stay simulated.** Alpaca provides stocks and ETFs, not the S&P 500 or NASDAQ Composite indices,
  so the dashboard's US index cards remain SIMULATED until another authorised source is added.
- **Alpaca IEX volume** (the default feed) covers only trades on the IEX exchange, a small share of US volume.
  Alpaca prices are split-adjusted.
- **Upstox does not document** whether daily candles are adjusted for splits and bonuses. Large jumps are
  flagged in the sync log.
- **Not yet checked against live responses with real credentials.** The adapters follow the official docs
  and are tested against documented and observed response shapes. Alpaca's daily-bar timestamp convention
  is undocumented: Mint converts it to the New York date and rejects any bar that lands on a weekend.
- **No app authentication.** Mint is a single-user app for your own machine. Do not expose it to the
  internet, because the sync endpoint uses your provider credentials.
- **Exchange holidays are not modelled** for session status or the simulated series. Provider data has no
  holiday bars, so it is unaffected.
- Alerts are evaluated only when you press **Check now**, and only price-level alerts exist. Background
  checks and other alert types arrive in Phase 7.
- End-of-day only: daily bars for completed sessions, no intraday or live quotes.
- A small demo universe: 4 indices and 17 stocks.
- `npm audit` reports a high-severity advisory in `effect`, a dependency of the **Prisma CLI's config
  loader** (dev tooling only, not shipped to the app). The only suggested fix is downgrading Prisma to 6.x,
  so it is left as-is until Prisma ships a patched release.

## Roadmap

1. ✅ Core foundation
2. Market data engine
   - ✅ 2A: Upstox/Alpaca daily history, validation, simulated fallback (this release)
   - 2B: trading calendars and holidays, an authorised source for US index levels, scheduled syncs
3. Technical analysis: RSI, MACD, SMA/EMA, Bollinger Bands, volume, trend, volatility, support/resistance
4. AI/ML (Python FastAPI): movement classification, sentiment, risk scoring, honest backtests
5. Personal portfolio
6. Paper trading
7. Smart alerts and daily briefings
8. Assisted broker integration: order preview with explicit approval, never automatic
