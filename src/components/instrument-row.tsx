import Link from "next/link";
import type { ReactNode } from "react";
import { ChangeText, SimulatedBadge, TypeBadge } from "@/components/ui";
import { formatPrice, formatTradingDate } from "@/lib/format";
import type { InstrumentWithQuoteDTO } from "@/lib/types";
import { sourceLabel } from "@/lib/market-data/types";

/**
 * One instrument line: symbol/name, last price, day change, freshness; optional trailing actions.
 * `compact` hides the per-row freshness column (the containing panel must then label the data source).
 */
export function InstrumentRow({
  instrument,
  actions,
  compact = false,
}: {
  instrument: InstrumentWithQuoteDTO;
  actions?: ReactNode;
  compact?: boolean;
}) {
  const q = instrument.quote;
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <Link href={`/explore/${instrument.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-9 w-14 shrink-0 place-items-center rounded-lg bg-surface-3 text-[10px] font-semibold text-muted">
          {instrument.market.code}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium group-hover:text-accent-strong">{instrument.symbol}</span>
            <TypeBadge type={instrument.type} />
          </span>
          <span className="block truncate text-xs text-subtle">{instrument.name}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {q ? (
            <>
              <span className="text-sm font-medium tabular-nums">
                {formatPrice(q.last, instrument.currency, instrument.type)}
              </span>
              <ChangeText
                change={q.change}
                changePercent={q.changePercent}
                currency={instrument.currency}
                showAbsolute={false}
                className="text-xs"
              />
            </>
          ) : (
            <span className="text-xs text-subtle">No data</span>
          )}
        </span>
        <span className={`hidden w-28 shrink-0 flex-col items-end gap-1 text-[11px] text-subtle ${compact ? "" : "md:flex"}`}>
          {q ? q.provenance.isSimulated ? <SimulatedBadge /> : <span className="text-muted">{sourceLabel(q.provenance.source)}</span> : null}
          {q ? <span>{formatTradingDate(q.provenance.asOfTradingDate)}</span> : null}
        </span>
      </Link>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </li>
  );
}
