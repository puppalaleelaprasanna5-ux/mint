import type { Metadata } from "next";
import { PlannedFeature } from "@/components/planned-feature";

export const metadata: Metadata = { title: "Paper Trading" };

export default function PaperTradingPage() {
  return (
    <PlannedFeature
      title="Paper trading"
      phase={6}
      summary="Practise buying and selling with virtual money — no real money at risk."
      planned={[
        "A virtual cash balance in ₹ and $.",
        "Simulated market and limit orders, filled against stored prices with realistic costs.",
        "Order history, a paper portfolio with profit/loss, and simple strategy tests.",
      ]}
      learn={[
        {
          title: "What is paper trading?",
          body: (
            <p>
              Making pretend trades to learn how markets and orders work, before risking real money. Results feel
              real, but there is no emotional pressure, so real trading usually feels harder.
            </p>
          ),
        },
        {
          title: "Market order vs limit order",
          body: (
            <p>
              A <strong className="text-fg">market order</strong> buys or sells right away at the best available
              price. A <strong className="text-fg">limit order</strong> only executes at your chosen price or
              better — it may never fill.
            </p>
          ),
        },
      ]}
    />
  );
}
