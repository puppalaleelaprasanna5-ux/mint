"use client";

import { useEffect, useRef } from "react";
import { createChart, HistogramSeries, LineSeries, LineStyle, type Time } from "lightweight-charts";
import type { IndicatorValue } from "@/lib/indicators";
import { baseChartOptions, CHART_COLORS } from "./chart-theme";

export interface PaneLine {
  label: string;
  color: string;
  values: IndicatorValue[];
}

/**
 * Small indicator chart (RSI or MACD) aligned with the main price chart's visible bars.
 * `times[i]` belongs to every `values[i]`; nulls (warm-up) are simply not drawn.
 */
export function IndicatorPane({
  title,
  times,
  lines,
  histogram,
  guides = [],
  range,
  emptyMessage,
}: {
  title: string;
  times: string[];
  lines: PaneLine[];
  histogram?: IndicatorValue[];
  guides?: { value: number; label: string }[];
  /** Fixed y-axis range, e.g. 0–100 for RSI. */
  range?: { min: number; max: number };
  emptyMessage: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasData = lines.some((l) => l.values.some((v) => v !== null));

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasData) return;
    const chart = createChart(el, { ...baseChartOptions(), timeScale: { ...baseChartOptions().timeScale, visible: false } });
    const autoscale = range ? () => ({ priceRange: { minValue: range.min, maxValue: range.max } }) : undefined;
    if (histogram) {
      const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
      h.setData(
        times.flatMap((t, i) =>
          histogram[i] === null
            ? []
            : [{ time: t as Time, value: histogram[i] as number, color: (histogram[i] as number) >= 0 ? "rgba(34,197,94,0.45)" : "rgba(244,63,94,0.45)" }],
        ),
      );
    }
    lines.forEach((l, li) => {
      const s = chart.addSeries(LineSeries, {
        color: l.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: l.label,
        ...(autoscale ? { autoscaleInfoProvider: autoscale } : {}),
      });
      s.setData(times.flatMap((t, i) => (l.values[i] === null ? [] : [{ time: t as Time, value: l.values[i] as number }])));
      if (li === 0) {
        for (const g of guides) {
          s.createPriceLine({ price: g.value, color: CHART_COLORS.text, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: g.label });
        }
      }
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [times, lines, histogram, guides, range, hasData]);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-medium text-muted">{title}</p>
      {hasData ? (
        <div ref={ref} className="h-32 w-full min-w-0 overflow-hidden" role="img" aria-label={`${title} chart`} />
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-subtle">{emptyMessage}</p>
      )}
    </div>
  );
}
