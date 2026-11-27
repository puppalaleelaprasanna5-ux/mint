"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { BarChart3, CandlestickChart, LineChart } from "lucide-react";
import type { BarDTO, DataProvenance } from "@/lib/types";
import { DETAIL_RANGES, describeSpan, selectRange, type DetailRangeKey } from "@/lib/chart-ranges";
import { formatInstant, formatPercent, formatTradingDate } from "@/lib/format";
import { sourceLabel } from "@/lib/market-data/types";
import { SimulatedBadge } from "@/components/ui";
import { baseChartOptions, CHART_COLORS } from "./chart-theme";

type Mode = "candles" | "line";

const segment = (active: boolean) =>
  `inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
    active ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"
  }`;

/**
 * Historical price chart: 1M–5Y calendar ranges, candlestick or line view, optional volume,
 * and a provenance strip (source, simulated/provider, last session, last updated).
 */
export function PriceChart({
  bars,
  provenance,
  timezone,
}: {
  bars: BarDTO[];
  provenance: DataProvenance | null;
  /** Exchange time zone, used to show when the data was last updated. */
  timezone: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<DetailRangeKey>("1Y");
  const [mode, setMode] = useState<Mode>("candles");
  const hasVolume = useMemo(() => bars.some((b) => b.volume > 0), [bars]);
  const [showVolume, setShowVolume] = useState(true);
  const volumeOn = hasVolume && showVolume;

  const selection = useMemo(() => selectRange(bars, range), [bars, range]);
  const visible = selection.bars;
  const first = visible[0];
  const last = visible[visible.length - 1];
  const rangeChange = first && last && first !== last ? (last.close / first.close - 1) * 100 : null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || visible.length === 0) return;
    const chart: IChartApi = createChart(el, baseChartOptions());
    let price: ISeriesApi<SeriesType>;
    if (mode === "candles") {
      price = chart.addSeries(CandlestickSeries, {
        upColor: CHART_COLORS.up,
        downColor: CHART_COLORS.down,
        borderVisible: false,
        wickUpColor: CHART_COLORS.up,
        wickDownColor: CHART_COLORS.down,
        priceLineVisible: false,
      });
      price.setData(visible.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    } else {
      const up = visible[visible.length - 1].close >= visible[0].close;
      const color = up ? CHART_COLORS.up : CHART_COLORS.down;
      price = chart.addSeries(AreaSeries, {
        lineColor: color,
        topColor: up ? "rgba(34,197,94,0.22)" : "rgba(244,63,94,0.22)",
        bottomColor: "rgba(0,0,0,0)",
        lineWidth: 2,
        priceLineVisible: false,
      });
      price.setData(visible.map((b) => ({ time: b.time as Time, value: b.close })));
    }
    if (volumeOn) {
      price.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
      const volume = chart.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      volume.setData(
        visible.map((b) => ({
          time: b.time as Time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(34,197,94,0.35)" : "rgba(244,63,94,0.35)",
        })),
      );
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [visible, mode, volumeOn]);

  if (bars.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <BarChart3 className="size-6 text-subtle" aria-hidden />
        <p className="text-sm font-medium">No price history stored</p>
        <p className="max-w-sm text-sm text-muted">
          Mint has no daily bars for this instrument yet. Run <code className="text-fg">npm run db:seed</code> for
          simulated data, or sync a provider from Settings.
        </p>
      </div>
    );
  }

  const firstStored = bars[0].time;
  const lastStored = bars[bars.length - 1].time;

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Chart range" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
          {DETAIL_RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)} className={segment(range === r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div role="group" aria-label="Chart type" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
            <button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")} className={segment(mode === "candles")}>
              <CandlestickChart className="size-3.5" aria-hidden /> Candles
            </button>
            <button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")} className={segment(mode === "line")}>
              <LineChart className="size-3.5" aria-hidden /> Line
            </button>
          </div>
          <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
            <button
              type="button"
              aria-pressed={volumeOn}
              disabled={!hasVolume}
              title={hasVolume ? "Show or hide trading volume" : "No volume data (indices have no trading volume)"}
              onClick={() => setShowVolume((v) => !v)}
              className={segment(volumeOn)}
            >
              <BarChart3 className="size-3.5" aria-hidden /> Volume
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          {first && last ? `${formatTradingDate(first.time)} – ${formatTradingDate(last.time)}` : ""} · {visible.length}{" "}
          session{visible.length === 1 ? "" : "s"}
          {rangeChange != null ? (
            <>
              {" · "}
              <span className={rangeChange >= 0 ? "text-up" : "text-down"}>{formatPercent(rangeChange)}</span> over range
            </>
          ) : null}
        </span>
        {selection.partial ? (
          <span role="note" className="text-warn">
            Only {describeSpan(firstStored, lastStored)} of history stored. Showing all of it.
          </span>
        ) : null}
      </div>

      <div ref={containerRef} className="h-80 w-full min-w-0 overflow-hidden sm:h-96" role="img" aria-label={`${mode === "candles" ? "Candlestick" : "Line"} price chart, ${range}`} />

      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-xs">
        <div className="flex items-center gap-1.5">
          <dt className="text-subtle">Source</dt>
          <dd className="flex items-center gap-1.5 text-fg">
            {provenance ? (provenance.isSimulated ? "Mint demo generator" : sourceLabel(provenance.source)) : "Unknown"}
            {provenance?.isSimulated ? (
              <SimulatedBadge />
            ) : provenance ? (
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
                Provider data
              </span>
            ) : null}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-subtle">Last session</dt>
          <dd className="text-fg">{formatTradingDate(lastStored)}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-subtle">{provenance?.isSimulated ? "Generated" : "Last updated"}</dt>
          <dd className="text-fg">{provenance ? formatInstant(provenance.fetchedAt, timezone) : "—"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-subtle">Stored history</dt>
          <dd className="text-fg">
            {formatTradingDate(firstStored)} – {formatTradingDate(lastStored)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
