"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, LineSeries, type Time } from "lightweight-charts";
import { toPercentFromStart } from "@/lib/quotes";
import { formatPercent } from "@/lib/format";
import { baseChartOptions, CHART_COLORS, type RangeKey } from "./chart-theme";
import { RangeTabs, sliceForRange } from "./range-tabs";

export interface PerformanceSeries {
  id: string;
  label: string;
  isSimulated: boolean;
  points: { time: string; close: number }[];
}

/** Compares benchmark indices as % change from the start of the selected range. */
export function PerformanceChart({ series }: { series: PerformanceSeries[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<RangeKey>("6M");

  const rebased = useMemo(
    () =>
      series.map((s, i) => ({
        ...s,
        color: CHART_COLORS.series[i % CHART_COLORS.series.length],
        data: toPercentFromStart(sliceForRange(s.points, range)),
      })),
    [series, range],
  );
  const available = Math.min(...series.map((s) => s.points.length));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      ...baseChartOptions(),
      localization: { priceFormatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` },
    });
    for (const s of rebased) {
      const line = chart.addSeries(LineSeries, {
        color: s.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: s.label,
      });
      line.setData(s.data.map((p) => ({ time: p.time as Time, value: p.value })));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [rebased]);

  if (series.length === 0 || available < 2) {
    return <p className="px-5 py-10 text-center text-sm text-muted">Not enough price history to draw a chart.</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {rebased.map((s) => {
            const last = s.data[s.data.length - 1]?.value ?? 0;
            return (
              <li key={s.id} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                <span className="text-muted">
                  {s.label}
                  {s.isSimulated ? <span className="text-warn"> (simulated)</span> : null}
                </span>
                <span className={last >= 0 ? "text-up" : "text-down"}>{formatPercent(last)}</span>
              </li>
            );
          })}
        </ul>
        <RangeTabs value={range} onChange={setRange} available={available} />
      </div>
      <div ref={containerRef} className="h-72 w-full min-w-0 overflow-hidden" aria-label="Index performance chart" role="img" />
    </div>
  );
}
