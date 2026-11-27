"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import type { WatchlistSummaryDTO } from "@/lib/types";
import { Card, CardHeader } from "@/components/ui";

/** Add/remove the current instrument to/from each watchlist. */
export function WatchlistToggle({
  instrumentId,
  symbol,
  watchlists,
  initialMemberOf,
}: {
  instrumentId: string;
  symbol: string;
  watchlists: WatchlistSummaryDTO[];
  initialMemberOf: string[];
}) {
  const router = useRouter();
  const [memberOf, setMemberOf] = useState(new Set(initialMemberOf));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = async (listId: string) => {
    setBusyId(listId);
    setError(null);
    const isMember = memberOf.has(listId);
    try {
      if (isMember) {
        await api(`/api/watchlists/${listId}/items/${instrumentId}`, { method: "DELETE" });
      } else {
        await api(`/api/watchlists/${listId}/items`, { method: "POST", json: { instrumentId } });
      }
      setMemberOf((prev) => {
        const next = new Set(prev);
        if (isMember) next.delete(listId);
        else next.add(listId);
        return next;
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Watchlists" subtitle={`Keep ${symbol} on your radar`} />
      <div className="flex flex-col gap-2 p-4 sm:p-5">
        {watchlists.length === 0 ? (
          <p className="text-sm text-muted">You have no watchlists yet. Create one from the Dashboard.</p>
        ) : (
          watchlists.map((w) => {
            const on = memberOf.has(w.id);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => toggle(w.id)}
                disabled={busyId !== null}
                aria-pressed={on}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm disabled:opacity-60 ${
                  on ? "border-accent/40 bg-accent-soft text-accent-strong" : "border-line text-muted hover:text-fg"
                }`}
              >
                <span>{w.name}</span>
                {busyId === w.id ? (
                  <Loader2 className="size-4 animate-spin" aria-label="Saving" />
                ) : on ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Check className="size-4" /> Added
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Plus className="size-4" /> Add
                  </span>
                )}
              </button>
            );
          })
        )}
        {error ? (
          <p role="alert" className="text-xs text-down">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
