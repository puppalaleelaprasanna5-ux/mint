import type { Metadata } from "next";
import { PlannedFeature } from "@/components/planned-feature";

export const metadata: Metadata = { title: "AI Analysis" };

export default function AnalysisPage() {
  return (
    <PlannedFeature
      title="AI analysis"
      phase={3}
      summary="Technical analysis (Phase 3) and machine-learning research (Phase 4), explained in plain language."
      planned={[
        "Technical indicators: RSI, MACD, moving averages (SMA/EMA), Bollinger Bands, volume analysis.",
        "Trend, volatility and support/resistance estimates, split into short-term and long-term views.",
        "Phase 4: experimental ML models with strict train/test separation, backtests that include trading costs, and visible uncertainty.",
        "Every result will say what data it used and how reliable it is. Mint will never promise returns.",
      ]}
      learn={[
        {
          title: "What is technical analysis?",
          body: (
            <p>
              Studying past prices and volume to describe what a stock has been doing — trending up, moving
              sideways, or swinging wildly. It describes the past; it cannot guarantee the future.
            </p>
          ),
        },
        {
          title: "What is a moving average?",
          body: (
            <p>
              The average closing price over the last N days (e.g. 50 days), recalculated every day. It smooths
              out daily noise so the general direction is easier to see.
            </p>
          ),
        },
        {
          title: "Why be careful with AI price predictions?",
          body: (
            <p>
              Markets are noisy and models easily find patterns that were just luck. Honest models report how
              often they were wrong on data they never saw, and after costs most simple signals disappear.
            </p>
          ),
        },
      ]}
    />
  );
}
