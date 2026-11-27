import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Card, CardHeader, PageHeader, SessionPill, SimulatedBadge, Skeleton } from "@/components/ui";
import { db } from "@/server/db";
import { listMarkets } from "@/server/services/markets";
import { getMarketDataStatus } from "@/server/services/market-data";
import { MarketDataPanel } from "@/components/settings/market-data-panel";
import { sourceLabel } from "@/lib/market-data/types";
import { getSessionStatus } from "@/lib/time";
import { formatInstant, formatTradingDate } from "@/lib/format";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Data sources, markets and database status for this Mint installation." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}

async function SettingsContent() {
  await connection();
  const now = new Date();
  const [markets, sources, counts, mdStatus] = await Promise.all([
    listMarkets(),
    db.priceBar.groupBy({
      by: ["source", "isSimulated"],
      _count: { _all: true },
      _min: { tradingDate: true },
      _max: { tradingDate: true, fetchedAt: true },
    }),
    Promise.all([
      db.instrument.count(),
      db.watchlist.count(),
      db.alert.count(),
      db.notification.count(),
    ]),
    getMarketDataStatus(),
  ]);
  const [instruments, watchlists, alerts, notifications] = counts;

  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-6">
      <MarketDataPanel status={mdStatus} />

      <Card>
        <CardHeader title="Stored price data" subtitle="Every bar in the database, by source" />
        {sources.length === 0 ? (
          <p className="p-5 text-sm text-muted">No price data stored. Run <code className="text-fg">npm run db:seed</code>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-subtle">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">Source</th>
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Bars</th>
                  <th className="px-5 py-2 font-medium">Sessions covered</th>
                  <th className="px-5 py-2 font-medium">Stored at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sources.map((s) => (
                  <tr key={`${s.source}-${s.isSimulated}`}>
                    <td className="px-5 py-3 font-mono text-xs">{s.source}</td>
                    <td className="px-5 py-3">{s.isSimulated ? <SimulatedBadge /> : sourceLabel(s.source)}</td>
                    <td className="px-5 py-3 tabular-nums">{s._count._all.toLocaleString("en-US")}</td>
                    <td className="px-5 py-3 text-muted">
                      {s._min.tradingDate && s._max.tradingDate
                        ? `${formatTradingDate(s._min.tradingDate)} – ${formatTradingDate(s._max.tradingDate)}`
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {s._max.fetchedAt ? formatInstant(s._max.fetchedAt, "Asia/Kolkata") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-muted">
          Simulated bars are kept as a fallback. For each instrument Mint shows provider data when it has any, otherwise
          the simulated series, never a mix of the two. Simulated prices must not be used for decisions.
        </p>
      </Card>

      <Card>
        <CardHeader title="Markets" subtitle="Exchange time zones, currencies and regular trading hours" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-subtle">
              <tr className="border-b border-line">
                <th className="px-5 py-2 font-medium">Exchange</th>
                <th className="px-5 py-2 font-medium">MIC</th>
                <th className="px-5 py-2 font-medium">Time zone</th>
                <th className="px-5 py-2 font-medium">Currency</th>
                <th className="px-5 py-2 font-medium">Hours (local)</th>
                <th className="px-5 py-2 font-medium">Now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {markets.map((m) => (
                <tr key={m.id}>
                  <td className="px-5 py-3">
                    <span className="font-medium">{m.code}</span>
                    <span className="block text-xs text-subtle">{m.name}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted">{m.mic}</td>
                  <td className="px-5 py-3 text-muted">{m.timezone}</td>
                  <td className="px-5 py-3 text-muted">{m.currency}</td>
                  <td className="px-5 py-3 tabular-nums text-muted">
                    {m.openTime} – {m.closeTime}
                  </td>
                  <td className="px-5 py-3">
                    <SessionPill session={getSessionStatus(m, now)} code={m.code} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Session status uses each exchange&apos;s regular hours and weekends only. Exchange holidays and special
          sessions are not modelled yet (Phase 2: trading calendars).
        </p>
      </Card>

      <Card>
        <CardHeader title="Database" subtitle="Local SQLite file (see DATABASE_URL in .env)" />
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-line sm:grid-cols-4">
          {[
            ["Instruments", instruments],
            ["Watchlists", watchlists],
            ["Alerts", alerts],
            ["Notifications", notifications],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-5 py-3">
              <dt className="text-xs text-subtle">{label}</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
