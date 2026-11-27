import type { Metadata } from "next";
import { PlannedFeature } from "@/components/planned-feature";

export const metadata: Metadata = { title: "Market News" };

export default function NewsPage() {
  return (
    <PlannedFeature
      title="Market news"
      phase={4}
      summary="Financial news for your markets and watchlist, with sentiment explained."
      planned={[
        "Headlines from a licensed news API, linked to the stocks they mention.",
        "Sentiment scoring (positive / neutral / negative) with a confidence level for each article.",
        "Plain-language summaries of why a story might matter for a stock.",
        "News alerts for stocks on your watchlist (Phase 7).",
      ]}
      learn={[
        {
          title: "Why does news move stock prices?",
          body: (
            <p>
              A share price reflects what investors expect a company to earn in the future. News that changes
              those expectations — results, new products, regulation, interest rates — can move the price.
            </p>
          ),
        },
        {
          title: "What is sentiment analysis?",
          body: (
            <p>
              Software that reads text and estimates whether its tone is positive or negative. It is a rough
              signal: sarcasm, context and already-expected news can fool it.
            </p>
          ),
        },
      ]}
    />
  );
}
