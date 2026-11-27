import type { Metadata } from "next";
import { PlannedFeature } from "@/components/planned-feature";

export const metadata: Metadata = { title: "My Portfolio" };

export default function PortfolioPage() {
  return (
    <PlannedFeature
      title="My portfolio"
      phase={5}
      summary="Track the investments you actually own across Indian and US markets."
      planned={[
        "Record buys, sells, dividends and fees for each holding.",
        "Current value, realized and unrealized profit/loss, in ₹ and $.",
        "Allocation by market, sector and stock, and performance over time.",
      ]}
      learn={[
        {
          title: "Realized vs unrealized profit",
          body: (
            <p>
              <strong className="text-fg">Unrealized</strong> profit is on paper — the gain on shares you still
              hold. It becomes <strong className="text-fg">realized</strong> only when you sell.
            </p>
          ),
        },
        {
          title: "What is average cost?",
          body: (
            <p>
              If you buy 10 shares at ₹100 and 10 more at ₹120, your average cost is ₹110 per share. Profit and
              loss are measured against this number.
            </p>
          ),
        },
        {
          title: "Why does allocation matter?",
          body: (
            <p>
              Spreading money across different companies, sectors and markets (diversification) reduces the
              damage any single bad investment can do.
            </p>
          ),
        },
      ]}
    />
  );
}
