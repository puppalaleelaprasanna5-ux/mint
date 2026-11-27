import { BrainCircuit, CalendarClock } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";

function PlannedBadge({ phase }: { phase: number }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
      Planned · Phase {phase}
    </span>
  );
}

/**
 * Placeholders required by the Phase 1 dashboard. They intentionally show NO generated insights —
 * Mint never invents analysis; these describe what will appear once the engines exist.
 */
export function AiInsightsPlaceholder() {
  return (
    <Card>
      <CardHeader title="AI insights" right={<PlannedBadge phase={4} />} />
      <div className="flex gap-3 p-4 text-sm sm:p-5">
        <BrainCircuit className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
        <div className="space-y-2 text-muted">
          <p className="text-fg">Not available yet — no AI model is running.</p>
          <p>
            Planned: plain-language explanations of what moved your watchlist, risk scores, and model
            signals that always show their confidence, test results and limitations.
          </p>
        </div>
      </div>
    </Card>
  );
}

export function DailyBriefingPlaceholder() {
  return (
    <Card>
      <CardHeader title="Daily briefing" right={<PlannedBadge phase={7} />} />
      <div className="flex gap-3 p-4 text-sm sm:p-5">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
        <div className="space-y-2 text-muted">
          <p className="text-fg">Not available yet — needs real market data and news.</p>
          <p>
            Planned: a short morning summary for India and an evening one for the US, covering index moves,
            your watchlist, triggered alerts and notable news.
          </p>
        </div>
      </div>
    </Card>
  );
}
