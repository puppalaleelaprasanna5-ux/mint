"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellOff, Loader2, Pause, Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { describeAlert, distanceToThresholdPercent } from "@/lib/alerts";
import { formatInstant, formatPercent, formatPrice } from "@/lib/format";
import type { AlertDTO, AlertEvaluationResultDTO } from "@/lib/types";
import { buttonStyles, Card, CardHeader, EmptyState, SimulatedBadge } from "@/components/ui";

const STATUS_STYLE: Record<AlertDTO["status"], string> = {
  ACTIVE: "border-accent/40 bg-accent-soft text-accent-strong",
  TRIGGERED: "border-warn/40 bg-warn-soft text-warn",
  PAUSED: "border-line text-subtle",
};

export function AlertList({ alerts, viewerTimeZone }: { alerts: AlertDTO[]; viewerTimeZone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const evaluate = () =>
    act("evaluate", async () => {
      setResult(null);
      const r = await api<AlertEvaluationResultDTO>("/api/alerts/evaluate", { method: "POST" });
      setResult(
        r.evaluated === 0
          ? "No active alerts to check."
          : `Checked ${r.evaluated} active alert${r.evaluated === 1 ? "" : "s"}: ${
              r.triggered.length ? `${r.triggered.length} triggered (${r.triggered.map((t) => t.symbol).join(", ")})` : "none triggered"
            }.`,
      );
    });

  const activeCount = alerts.filter((a) => a.status === "ACTIVE").length;

  return (
    <Card>
      <CardHeader
        title="Your alerts"
        subtitle={`${activeCount} active · ${alerts.length} total`}
        right={
          <button type="button" onClick={evaluate} disabled={busy !== null || activeCount === 0} className={buttonStyles.secondary}>
            {busy === "evaluate" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Check now
          </button>
        }
      />
      {result ? (
        <p role="status" className="border-b border-line px-4 py-2 text-xs text-muted sm:px-5">
          {result} Each alert is checked against its instrument&apos;s latest stored daily close; alerts on SIMULATED instruments are demonstrations only.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="border-b border-line bg-down/10 px-4 py-2 text-xs text-down sm:px-5">
          {error}
        </p>
      ) : null}

      {alerts.length === 0 ? (
        <EmptyState icon={<BellOff className="size-6" />} title="No alerts yet">
          Create one with the form, or from any stock&apos;s page in{" "}
          <Link href="/explore" className="text-accent-strong hover:underline">
            Explore
          </Link>
          .
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {alerts.map((a) => {
            const inst = a.instrument;
            const fmt = (v: number) => formatPrice(v, inst.currency, inst.type);
            const last = inst.quote?.last;
            const distance = last != null ? distanceToThresholdPercent(last, a.threshold) : null;
            return (
              <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/explore/${inst.id}`} className="text-sm font-medium hover:text-accent-strong">
                      {inst.symbol}
                    </Link>
                    <span className="text-xs text-subtle">{inst.market.code}</span>
                    <span className={`rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[a.status]}`}>
                      {a.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{describeAlert(a.type, fmt(a.threshold))}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
                    {last != null ? (
                      <span>
                        Latest close {fmt(last)}
                        {distance != null && a.status !== "TRIGGERED" ? ` · ${formatPercent(distance)} to level` : ""}
                      </span>
                    ) : (
                      <span>No price data</span>
                    )}
                    {inst.quote?.provenance.isSimulated ? <SimulatedBadge /> : null}
                    {a.status === "TRIGGERED" && a.triggeredAt && a.triggeredValue != null ? (
                      <span className="text-warn">
                        Triggered at {fmt(a.triggeredValue)} · {formatInstant(a.triggeredAt, viewerTimeZone)}
                      </span>
                    ) : null}
                  </p>
                  {a.note ? <p className="mt-1 text-xs italic text-subtle">“{a.note}”</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {a.status === "ACTIVE" ? (
                    <button
                      type="button"
                      className={buttonStyles.ghost}
                      disabled={busy !== null}
                      onClick={() => act(a.id, () => api(`/api/alerts/${a.id}`, { method: "PATCH", json: { status: "PAUSED" } }))}
                    >
                      <Pause className="size-4" /> Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={buttonStyles.ghost}
                      disabled={busy !== null}
                      onClick={() => act(a.id, () => api(`/api/alerts/${a.id}`, { method: "PATCH", json: { status: "ACTIVE" } }))}
                    >
                      {a.status === "TRIGGERED" ? <RotateCcw className="size-4" /> : <Play className="size-4" />}
                      {a.status === "TRIGGERED" ? "Re-arm" : "Resume"}
                    </button>
                  )}
                  <button
                    type="button"
                    className={buttonStyles.danger}
                    disabled={busy !== null}
                    aria-label={`Delete alert for ${inst.symbol}`}
                    onClick={() => {
                      if (window.confirm(`Delete this ${inst.symbol} alert?`)) {
                        void act(a.id, () => api(`/api/alerts/${a.id}`, { method: "DELETE" }));
                      }
                    }}
                  >
                    {busy === a.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
