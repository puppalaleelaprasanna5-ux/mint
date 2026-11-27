import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardHeader,
  ChangeText,
  Explainer,
  Freshness,
  Skeleton,
  TypeBadge,
} from "@/components/ui";
import { PriceChart } from "@/components/charts/price-chart";
import { WatchlistToggle } from "@/components/explore/watchlist-toggle";
import { AlertForm } from "@/components/alerts/alert-form";
import { HttpError } from "@/server/http";
import { getInstrumentWithQuote } from "@/server/services/instruments";
import { getDailyBars } from "@/server/services/prices";
import { listWatchlists, watchlistIdsContaining } from "@/server/services/watchlists";
import { listAlerts } from "@/server/services/alerts";
import { computeRangeStats } from "@/lib/quotes";
import { formatPrice, formatVolume } from "@/lib/format";
import { describeAlert } from "@/lib/alerts";

type Params = Promise<{ id: string }>;

export default function InstrumentPage({ params }: { params: Params }) {
  return (
    <>
      <Link href="/explore" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Explore
      </Link>
      <Suspense fallback={<InstrumentSkeleton />}>
        <InstrumentDetail params={params} />
      </Suspense>
    </>
  );
}

async function InstrumentDetail({ params }: { params: Params }) {
  await connection();
  const { id } = await params;

  let instrument;
  try {
    instrument = await getInstrumentWithQuote(id);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  const [history, watchlists, memberOf, alerts] = await Promise.all([
    getDailyBars(id, { limit: 5000 }),
    listWatchlists(),
    watchlistIdsContaining(id),
    listAlerts({ instrumentId: id }),
  ]);

  const q = instrument.quote;
  const yearBars = history.bars.slice(-252);
  const stats = computeRangeStats(yearBars);
  const isIndex = instrument.type === "INDEX";
  const fmt = (v: number) => formatPrice(v, instrument.currency, instrument.type);

  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{instrument.symbol}</h1>
            <TypeBadge type={instrument.type} />
            <span className="text-xs text-subtle">
              {instrument.market.code} · {instrument.currency}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {instrument.name}
            {instrument.sector ? ` · ${instrument.sector}` : ""}
          </p>
        </div>
        {q ? (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-semibold tabular-nums tracking-tight">{fmt(q.last)}</span>
              <ChangeText change={q.change} changePercent={q.changePercent} currency={instrument.currency} />
            </div>
            <Freshness provenance={q.provenance} />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="grid grid-cols-1 gap-4 lg:col-span-2 lg:gap-6">
          <Card>
            <CardHeader
              title="Price history"
              subtitle={`Daily prices · ${history.bars.length} sessions stored`}
            />
            <PriceChart bars={history.bars} provenance={history.provenance} timezone={instrument.market.timezone} />
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <Explainer title="How do I read a candlestick chart?">
                <p>
                  Each candle is one trading day. The thick body spans the opening and closing price:{" "}
                  <span className="text-up">green</span> means it closed higher than it opened,{" "}
                  <span className="text-down">red</span> means lower. The thin lines (wicks) show the day&apos;s
                  highest and lowest price.
                </p>
                <p>
                  <strong className="text-fg">Line</strong> view draws only the closing prices, which makes the overall
                  trend easier to see over long ranges like 1Y or 5Y.
                </p>
                {!isIndex ? (
                  <p>
                    The bars at the bottom show volume — how many shares changed hands. Big moves on high volume
                    usually mean more traders took part.
                  </p>
                ) : null}
              </Explainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Key numbers" subtitle="Calculated from the stored daily bars (last ~12 months)" />
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-line sm:grid-cols-4">
              <Stat label="Previous close" value={q?.previousClose != null ? fmt(q.previousClose) : "—"} />
              <Stat label="12-month high" value={stats ? fmt(stats.high) : "—"} />
              <Stat label="12-month low" value={stats ? fmt(stats.low) : "—"} />
              <Stat
                label="Avg. volume (20 days)"
                value={stats?.averageVolume != null ? formatVolume(stats.averageVolume, instrument.currency) : "n/a"}
              />
            </dl>
          </Card>
        </div>

        <div className="grid content-start gap-4 lg:gap-6">
          <WatchlistToggle
            instrumentId={instrument.id}
            symbol={instrument.symbol}
            watchlists={watchlists}
            initialMemberOf={memberOf}
          />
          <Card>
            <CardHeader title="Price alert" subtitle="Get flagged when the price crosses a level" />
            <div className="p-4 sm:p-5">
              <AlertForm instruments={[instrument]} />
            </div>
            {alerts.length ? (
              <div className="border-t border-line px-4 py-3 sm:px-5">
                <p className="mb-2 text-xs font-medium text-muted">Your alerts for {instrument.symbol}</p>
                <ul className="space-y-1.5 text-xs">
                  {alerts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="text-muted">{describeAlert(a.type, fmt(a.threshold))}</span>
                      <span className="text-subtle">{a.status.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/alerts" className="mt-2 inline-block text-xs text-accent-strong hover:underline">
                  Manage alerts
                </Link>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function InstrumentSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading instrument">
      <Skeleton className="h-12 w-64" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-[480px] lg:col-span-2" />
        <Skeleton className="h-[480px]" />
      </div>
    </div>
  );
}
