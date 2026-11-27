import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { Card, CardHeader, EmptyState, Explainer, PageHeader, Skeleton } from "@/components/ui";
import { AlertForm } from "@/components/alerts/alert-form";
import { AlertList } from "@/components/alerts/alert-list";
import { listAlerts, listNotifications } from "@/server/services/alerts";
import { searchInstruments } from "@/server/services/instruments";
import { formatInstant } from "@/lib/format";

export const metadata: Metadata = { title: "Smart Alerts" };

/** Times on this page are shown in Indian Standard Time (the user's home market). */
const VIEWER_TZ = "Asia/Kolkata";

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        title="Smart alerts"
        description="Set price levels you care about. Mint flags an alert when the latest close crosses your level."
      />
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <AlertsContent />
      </Suspense>
    </>
  );
}

async function AlertsContent() {
  await connection();
  const [alerts, instruments, notifications] = await Promise.all([
    listAlerts(),
    searchInstruments({ q: "", limit: 100 }),
    listNotifications(20),
  ]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
      <div className="grid content-start gap-4 lg:col-span-3 lg:gap-6">
        <AlertList alerts={alerts} viewerTimeZone={VIEWER_TZ} />
        <Card>
          <CardHeader title="Alert activity" subtitle="Most recent first · times in IST" />
          {notifications.length === 0 ? (
            <EmptyState icon={<Bell className="size-6" />} title="Nothing has triggered yet" />
          ) : (
            <ul className="divide-y divide-line">
              {notifications.map((n) => (
                <li key={n.id} className="px-4 py-3 sm:px-5">
                  <p className="text-sm">{n.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{n.body}</p>
                  <p className="mt-0.5 text-[11px] text-subtle">{formatInstant(n.createdAt, VIEWER_TZ)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid content-start gap-4 lg:col-span-2 lg:gap-6">
        <Card>
          <CardHeader title="New price alert" />
          <div className="p-4 sm:p-5">
            {instruments.length ? (
              <AlertForm instruments={instruments} />
            ) : (
              <p className="text-sm text-muted">No instruments in the database. Run the seed first.</p>
            )}
          </div>
        </Card>
        <Explainer title="What can alerts do right now?">
          <p>
            In this version alerts are checked when you press <strong className="text-fg">Check now</strong>,
            against the most recent <em>daily closing</em> price stored in Mint. For instruments marked{" "}
            <strong className="text-warn">SIMULATED</strong> a triggered alert is only a demonstration, not a real
            market event. Even with provider data, prices are end-of-day, not live.
          </p>
          <p>
            Automatic background checks, percentage-move, unusual-volume, news and AI-signal alerts, and daily
            summaries are planned for Phase 7.
          </p>
        </Explainer>
      </div>
    </div>
  );
}
