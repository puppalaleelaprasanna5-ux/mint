import { ColorType, CrosshairMode, type DeepPartial, type ChartOptions } from "lightweight-charts";

export const CHART_COLORS = {
  text: "#9aa3ad",
  grid: "#1c2128",
  border: "#262c34",
  up: "#22c55e",
  down: "#f43f5e",
  series: ["#34d399", "#60a5fa", "#f5a524", "#c084fc"],
};

export const RANGES = [
  { key: "1M", label: "1M", bars: 21 },
  { key: "3M", label: "3M", bars: 63 },
  { key: "6M", label: "6M", bars: 126 },
  { key: "1Y", label: "1Y", bars: 252 },
  { key: "ALL", label: "All", bars: Infinity },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export function baseChartOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: CHART_COLORS.text,
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: CHART_COLORS.grid },
      horzLines: { color: CHART_COLORS.grid },
    },
    rightPriceScale: { borderColor: CHART_COLORS.border },
    timeScale: { borderColor: CHART_COLORS.border, fixLeftEdge: true, fixRightEdge: true },
    crosshair: { mode: CrosshairMode.Magnet },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
  };
}
