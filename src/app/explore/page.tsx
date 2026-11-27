import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Explainer, PageHeader, Skeleton } from "@/components/ui";
import { InstrumentSearch } from "@/components/explore/instrument-search";
import { searchInstruments } from "@/server/services/instruments";
import { parseMarketFilter } from "@/lib/validation";

export const metadata: Metadata = { title: "Explore Stocks" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        title="Explore stocks"
        description="Search Indian (NSE/BSE) and US (NASDAQ/NYSE) stocks and indices. Open one to see its price chart, add it to a watchlist or set a price alert."
      />
      <div className="mb-4">
        <Explainer title="New to this? What are NSE, BSE, NASDAQ and NYSE?">
          <p>
            They are stock exchanges — marketplaces where shares are bought and sold. NSE and BSE are in India
            (prices in ₹), NASDAQ and NYSE are in the US (prices in $).
          </p>
          <p>
            A <strong className="text-fg">stock</strong> is a small piece of ownership in one company. An{" "}
            <strong className="text-fg">index</strong> (like NIFTY 50 or the S&amp;P 500) is a number that tracks a
            group of stocks, used to see how the overall market is doing. You can&apos;t buy an index directly here.
          </p>
        </Explainer>
      </div>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <ExploreResults searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ExploreResults({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const region = parseMarketFilter((await searchParams).market);
  const initial = await searchInstruments({ q: "", region: region === "ALL" ? undefined : region, limit: 50 });
  return <InstrumentSearch initialResults={initial} initialRegion={region} />;
}
