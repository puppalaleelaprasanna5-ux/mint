import { connection } from "next/server";
import { Database, FlaskConical } from "lucide-react";
import { getDataCoverage } from "@/server/services/sources";
import { sourceLabel } from "@/lib/market-data/types";

const WARN = "border-warn/25 bg-warn-soft text-warn";
const INFO = "border-accent/20 bg-accent-soft text-accent-strong";

function Shell({ tone, icon, children }: { tone: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="status" className={`flex items-start gap-2 border-b px-4 py-2 text-xs sm:items-center lg:px-8 ${tone}`}>
      <span className="mt-px shrink-0 sm:mt-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

/** States, on every page, whether prices are simulated, provider-backed or a mix of both. */
export async function DataModeBanner() {
  await connection();
  const c = await getDataCoverage();
  const sources = c.providerSources.map(sourceLabel).join(", ");

  if (c.providerBacked === 0) {
    return (
      <Shell tone={WARN} icon={<FlaskConical className="size-3.5" aria-hidden />}>
        <strong className="font-semibold">Demo data mode.</strong> All prices and charts are{" "}
        <strong className="font-semibold">simulated</strong>. No market-data provider has been synced yet (see
        Settings).
      </Shell>
    );
  }
  if (c.simulatedOnly > 0) {
    return (
      <Shell tone={WARN} icon={<Database className="size-3.5" aria-hidden />}>
        <strong className="font-semibold">Mixed data.</strong> {c.providerBacked} of {c.instrumentsWithData} instruments
        use end-of-day history from {sources}; the other {c.simulatedOnly} are{" "}
        <strong className="font-semibold">simulated</strong> and marked SIMULATED. Nothing is live.
      </Shell>
    );
  }
  return (
    <Shell tone={INFO} icon={<Database className="size-3.5" aria-hidden />}>
      End-of-day historical data from {sources}. Prices are daily closes, not live quotes.
    </Shell>
  );
}

/** Prerendered placeholder while the data mode is being determined. */
export function DataModeBannerFallback() {
  return (
    <Shell tone="border-line bg-surface text-subtle" icon={<Database className="size-3.5" aria-hidden />}>
      Checking data sources…
    </Shell>
  );
}
