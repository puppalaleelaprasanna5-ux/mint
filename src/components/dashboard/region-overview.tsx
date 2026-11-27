import Link from "next/link";
import { Card, CardHeader, ChangeText, Freshness, SessionPill, Sparkline } from "@/components/ui";
import { formatPoints } from "@/lib/format";
import type { IndexSnapshotDTO, RegionOverviewDTO } from "@/lib/types";

const INDEX_BLURBS: Record<string, string> = {
  NIFTY50: "50 of the largest companies listed on the NSE.",
  SENSEX: "30 large, established companies listed on the BSE.",
  IXIC: "Almost every stock listed on Nasdaq — tech-heavy.",
  SPX: "500 large US companies — the most-watched US benchmark.",
};

function IndexCard({ index }: { index: IndexSnapshotDTO }) {
  const q = index.quote;
  const spark = index.sparkline.slice(-30).map((p) => p.close);
  return (
    <Link
      href={`/explore/${index.id}`}
      className="group flex flex-col gap-3 rounded-lg border border-line bg-surface-2/50 p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <div>
        <p className="text-sm font-medium group-hover:text-accent-strong">{index.name}</p>
        <p className="text-xs text-subtle">{INDEX_BLURBS[index.symbol] ?? index.market.code}</p>
      </div>
      {q ? (
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatPoints(q.last, index.currency)}
            </span>
            <ChangeText change={q.change} changePercent={q.changePercent} currency={index.currency} className="text-sm" />
          </div>
          <Sparkline values={spark} width={88} height={32} className="mb-1 shrink-0" />
        </div>
      ) : (
        <p className="text-sm text-muted">No data</p>
      )}
      <Freshness provenance={q?.provenance ?? null} />
    </Link>
  );
}

export function RegionOverview({ overview }: { overview: RegionOverviewDTO }) {
  return (
    <Card>
      <CardHeader
        title={`${overview.label} market`}
        subtitle={overview.region === "IN" ? "Prices in Indian rupees (₹) · IST" : "Prices in US dollars ($) · New York time"}
        right={
          <div className="flex flex-wrap justify-end gap-1.5">
            {overview.markets.map((m) => (
              <SessionPill key={m.id} session={m.session} code={m.code} />
            ))}
          </div>
        }
      />
      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        {overview.indices.length ? (
          overview.indices.map((idx) => <IndexCard key={idx.id} index={idx} />)
        ) : (
          <p className="text-sm text-muted">No benchmark indices found. Run the database seed.</p>
        )}
      </div>
    </Card>
  );
}
