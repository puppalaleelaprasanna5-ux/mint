import Link from "next/link";
import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { Card, CardHeader, Explainer, PageHeader } from "@/components/ui";

/** Page for a section whose functionality arrives in a later phase. Shows no fake data or controls. */
export function PlannedFeature({
  title,
  phase,
  summary,
  planned,
  learn,
}: {
  title: string;
  phase: number;
  summary: string;
  planned: string[];
  learn: { title: string; body: ReactNode }[];
}) {
  return (
    <>
      <PageHeader title={title} description={summary} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Not built yet"
            right={
              <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
                Planned · Phase {phase}
              </span>
            }
          />
          <div className="flex gap-3 p-4 sm:p-5">
            <Construction className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
            <div className="text-sm">
              <p className="text-muted">This section has no working features in the current version. What is planned:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted marker:text-subtle">
                {planned.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <p className="mt-4 text-muted">
                Meanwhile you can browse charts in{" "}
                <Link href="/explore" className="text-accent-strong hover:underline">
                  Explore
                </Link>{" "}
                or set price levels in{" "}
                <Link href="/alerts" className="text-accent-strong hover:underline">
                  Smart Alerts
                </Link>
                .
              </p>
            </div>
          </div>
        </Card>
        <div className="grid content-start gap-3 lg:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">Learn the basics</p>
          {learn.map((l) => (
            <Explainer key={l.title} title={l.title}>
              {l.body}
            </Explainer>
          ))}
        </div>
      </div>
    </>
  );
}
