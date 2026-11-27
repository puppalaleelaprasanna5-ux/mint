"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
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
import { bollingerBands, closes as closesOf, ema, macd, rsi, sma, type IndicatorValue } from "@/lib/indicators";
import { IndicatorPane } from "./indicator-pane";

type OverlayKey = "ema20" | "sma50" | "sma200" | "bb";
const OVERLAYS: { key: OverlayKey; label: string; color: string; minBars: number }[] = [
  { key: "ema20", label: "EMA 20", color: "#60a5fa", minBars: 20 },
  { key: "sma50", label: "SMA 50", color: "#f5a524", minBars: 50 },
  { key: "sma200", label: "SMA 200", color: "#c084fc", minBars: 200 },
  { key: "bb", label: "Bollinger", color: "#94a3b8", minBars: 20 },
];
const RSI_GUIDES = [
  { value: 70, label: "70" },
  { value: 30, label: "30" },
];
const RSI_RANGE = { min: 0, max: 100 };

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
  const [overlays, setOverlays] = useState<Set<OverlayKey>>(new Set());
  const [panes, setPanes] = useState({ rsi: false, macd: false });
  const toggleOverlay = (k: OverlayKey) =>
    setOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Indicators use the FULL history, then get cut to the visible range, so long averages are
  // already warmed up at the left edge of short ranges.
  const full = useMemo(() => {
    const c = closesOf(bars);
    const bb = bollingerBands(c, 20, 2);
    return { ema20: ema(c, 20), sma50: sma(c, 50), sma200: sma(c, 200), bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower, rsi: rsi(c, 14), macd: macd(c, 12, 26, 9) };
  }, [bars]);

  const selection = useMemo(() => selectRange(bars, range), [bars, range]);
  const visible = selection.bars;
  const first = visible[0];
  const last = visible[visible.length - 1];
  const rangeChange = first && last && first !== last ? (last.close / first.close - 1) * 100 : null;
  const offset = bars.length - visible.length; // visible is always the most recent slice
  const cut = useMemo(() => (v: IndicatorValue[]) => v.slice(offset), [offset]);
  const times = useMemo(() => visible.map((b) => b.time), [visible]);
  const rsiLines = useMemo(() => [{ label: "RSI 14", color: "#34d399", values: cut(full.rsi) }], [cut, full]);
  const macdLines = useMemo(
    () => [
      { label: "MACD", color: "#60a5fa", values: cut(full.macd.macd) },
      { label: "Signal", color: "#f5a524", values: cut(full.macd.signal) },
    ],
    [cut, full],
  );
  const macdHist = useMemo(() => cut(full.macd.histogram), [cut, full]);

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
    const line = (values: IndicatorValue[], color: string, title: string, dashed = false) => {
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: dashed ? 1 : 2,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title,
      });
      const slice = values.slice(offset);
      s.setData(visible.flatMap((b, i) => (slice[i] === null ? [] : [{ time: b.time as Time, value: slice[i] as number }])));
    };
    for (const o of OVERLAYS) {
      if (!overlays.has(o.key)) continue;
      if (o.key === "bb") {
        line(full.bbUpper, o.color, "BB upper", true);
        line(full.bbMiddle, o.color, "BB mid", true);
        line(full.bbLower, o.color, "BB lower", true);
      } else {
        line(full[o.key], o.color, o.label);
      }
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [visible, mode, volumeOn, overlays, full, offset]);

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

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-subtle">Overlays</span>
        {OVERLAYS.map((o) => {
          const tooShort = bars.length < o.minBars;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={overlays.has(o.key)}
              disabled={tooShort}
              title={tooShort ? `Needs ${o.minBars} days of history (have ${bars.length})` : undefined}
              onClick={() => toggleOverlay(o.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                overlays.has(o.key) ? "border-line-strong bg-surface-3 text-fg" : "border-line text-muted hover:text-fg"
              }`}
            >
              <span className="size-2 rounded-full" style={{ background: o.color }} aria-hidden />
              {o.label}
            </button>
          );
        })}
        <span className="ml-1 text-subtle">Panels</span>
        {(["rsi", "macd"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={panes[k]}
            onClick={() => setPanes((p) => ({ ...p, [k]: !p[k] }))}
            className={`rounded-full border px-2.5 py-1 font-medium ${panes[k] ? "border-line-strong bg-surface-3 text-fg" : "border-line text-muted hover:text-fg"}`}
          >
            {k.toUpperCase()}
          </button>
        ))}
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

      {panes.rsi ? (
        <IndicatorPane
          title="RSI (14): above 70 overbought, below 30 oversold"
          times={times}
          lines={rsiLines}
          guides={RSI_GUIDES}
          range={RSI_RANGE}
          emptyMessage={`RSI needs 15 days of history; only ${bars.length} stored.`}
        />
      ) : null}
      {panes.macd ? (
        <IndicatorPane
          title="MACD (12, 26, 9): line, signal and histogram"
          times={times}
          lines={macdLines}
          histogram={macdHist}
          emptyMessage={`MACD needs 26 days of history (34 for the signal line); only ${bars.length} stored.`}
        />
      ) : null}

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
