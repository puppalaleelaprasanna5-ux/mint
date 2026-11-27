import { Suspense } from "react";
import { connection } from "next/server";
import { Card, CardHeader, Explainer, PageHeader, SimulatedBadge, Skeleton } from "@/components/ui";
import { MarketSelector } from "@/components/market-selector";
import { RegionOverview } from "@/components/dashboard/region-overview";
import { WatchlistPanel } from "@/components/dashboard/watchlist-panel";
import { AiInsightsPlaceholder, DailyBriefingPlaceholder } from "@/components/dashboard/planned-cards";
import { PerformanceChart } from "@/components/charts/performance-chart";
import { getRegionOverviews, regionsFor } from "@/server/services/markets";
import { getDefaultWatchlistId, getWatchlist, listWatchlists } from "@/server/services/watchlists";
import { parseMarketFilter } from "@/lib/validation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const filter = parseMarketFilter((await searchParams).market);
  const regions = regionsFor(filter);

  const [overviews, lists, defaultId] = await Promise.all([
    getRegionOverviews(filter),
    listWatchlists(),
    getDefaultWatchlistId(),
  ]);
  const watchlist = defaultId ? await getWatchlist(defaultId) : null;
  const series = overviews.flatMap((o) =>
    o.indices.map((i) => ({
      id: i.id,
      label: i.name,
      isSimulated: i.quote?.provenance.isSimulated ?? true,
      points: i.sparkline,
    })),
  );
  const watchKey = watchlist ? `${watchlist.id}:${watchlist.items.map((i) => i.id).join(",")}` : "none";

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A snapshot of Indian and US markets and the stocks you follow."
        actions={<MarketSelector value={filter} basePath="/" />}
      />

      <div className="grid grid-cols-1 gap-4 lg:gap-6">
        <div className={`grid grid-cols-1 gap-4 lg:gap-6 ${overviews.length > 1 ? "xl:grid-cols-2" : ""}`}>
          {overviews.map((o) => (
            <RegionOverview key={o.region} overview={o} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
          <Card className="lg:col-span-3">
            <CardHeader
              title="Market performance"
              subtitle="How each index changed over the period, in % — so markets of different sizes can be compared."
              right={series.some((s) => s.isSimulated) ? <SimulatedBadge /> : null}
            />
            <PerformanceChart series={series} />
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <Explainer title="How do I read this chart?">
                <p>
                  Every line starts at 0% on the first day of the selected range. A line at +5% means the index is
                  5% higher than it was at the start of that range.
                </p>
                <p>
                  Indian and US markets trade in different currencies and time zones, so this compares direction
                  and size of moves, not money.
                </p>
              </Explainer>
            </div>
          </Card>
          <div className="lg:col-span-2">
            <WatchlistPanel key={watchKey} initialLists={lists} initialList={watchlist} regions={regions} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6">
          <AiInsightsPlaceholder />
          <DailyBriefingPlaceholder />
        </div>
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-96 lg:col-span-3" />
        <Skeleton className="h-96 lg:col-span-2" />
      </div>
    </div>
  );
}
