"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, Loader2, RefreshCw } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { formatInstant } from "@/lib/format";
import { sourceLabel } from "@/lib/market-data/types";
import type { MarketDataStatusDTO } from "@/server/services/market-data";
import type { SyncReport } from "@/server/market-data/sync";
import { buttonStyles, Card, CardHeader } from "@/components/ui";

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "text-up",
  PARTIAL: "text-warn",
  FAILED: "text-down",
  SKIPPED: "text-subtle",
};

const TZ = "Asia/Kolkata";

export function MarketDataPanel({ status }: { status: MarketDataStatusDTO }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const anyConfigured = status.providers.some((p) => p.configured);

  const sync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const report = await api<SyncReport>("/api/market-data/sync", { method: "POST", json: {} });
      const count = (s: string) => report.items.filter((i) => i.status === s).length;
      const inserted = report.items.reduce((n, i) => n + i.inserted, 0);
      const updated = report.items.reduce((n, i) => n + i.updated, 0);
      setResult({
        kind: count("FAILED") ? "error" : "ok",
        text: `${report.items.length} instruments: ${count("SUCCESS")} ok, ${count("PARTIAL")} partial, ${count("FAILED")} failed, ${count("SKIPPED")} skipped · ${inserted} bars added, ${updated} updated.`,
      });
      router.refresh();
    } catch (err) {
      setResult({ kind: "error", text: errorMessage(err) });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Market-data providers"
        subtitle={`${status.coverage.providerBacked} of ${status.coverage.instrumentsWithData} instruments use provider data · the rest use the simulated fallback`}
        right={
          <button type="button" onClick={sync} disabled={syncing || !anyConfigured || status.syncInProgress} className={buttonStyles.secondary}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Sync daily history
          </button>
        }
      />
      {result ? (
        <p role={result.kind === "error" ? "alert" : "status"} className={`border-b border-line px-5 py-2 text-xs ${result.kind === "error" ? "text-down" : "text-muted"}`}>
          {result.text}
        </p>
      ) : null}
      {!anyConfigured ? (
        <p className="border-b border-line px-5 py-2 text-xs text-muted">
          No provider is configured, so syncing is disabled. Add credentials to <code className="text-fg">.env</code> (see{" "}
          <code className="text-fg">.env.example</code>) and restart the server.
        </p>
      ) : null}

      <div className="grid gap-px bg-line md:grid-cols-2">
        {status.providers.map((p) => (
          <div key={p.id} className="space-y-2 bg-surface px-5 py-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {p.name} <span className="text-xs font-normal text-subtle">· {p.regions.join(", ")}</span>
              </span>
              {p.configured ? (
                <span className="inline-flex items-center gap-1 text-xs text-up">
                  <CheckCircle2 className="size-3.5" /> Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-subtle">
                  <CircleDashed className="size-3.5" /> Not configured
                </span>
              )}
            </div>
            {p.missingEnv.length ? (
              <p className="text-xs text-muted">
                Needs: {p.missingEnv.map((e) => <code key={e} className="mr-1 rounded bg-surface-3 px-1 text-fg">{e}</code>)}
              </p>
            ) : null}
            <p className="text-xs text-subtle">
              {p.mappedInstruments} mapped instruments · last sync {p.lastSyncAt ? formatInstant(p.lastSyncAt, TZ) : "never"}
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted marker:text-subtle">
              {p.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line">
        <p className="px-5 pt-3 text-xs font-medium text-muted">Recent sync activity</p>
        {status.recentSyncs.length === 0 ? (
          <p className="px-5 py-3 text-xs text-subtle">No syncs have run yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-subtle">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">When (IST)</th>
                  <th className="px-3 py-2 font-medium">Instrument</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Range</th>
                  <th className="px-3 py-2 font-medium">New / upd / same / rej</th>
                  <th className="px-5 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {status.recentSyncs.map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2 text-muted">{formatInstant(s.finishedAt, TZ)}</td>
                    <td className="px-3 py-2">{s.symbol ?? "—"}</td>
                    <td className={`px-3 py-2 font-medium ${STATUS_STYLE[s.status] ?? ""}`}>{s.status}</td>
                    <td className="px-3 py-2 text-muted">{s.source ? sourceLabel(s.source) : s.provider}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">
                      {s.fromDate} → {s.toDate}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted">
                      {s.inserted} / {s.updated} / {s.unchanged} / {s.rejected}
                    </td>
                    <td className="max-w-md px-5 py-2 text-muted">{s.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
