"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Plus, Star, Trash2, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import type { RegionCode, WatchlistDTO, WatchlistSummaryDTO } from "@/lib/types";
import { buttonStyles, Card, CardHeader, EmptyState, inputStyles, SimulatedBadge } from "@/components/ui";
import { InstrumentRow } from "@/components/instrument-row";

export function WatchlistPanel({
  initialLists,
  initialList,
  regions,
}: {
  initialLists: WatchlistSummaryDTO[];
  initialList: WatchlistDTO | null;
  /** Regions selected by the dashboard market filter. */
  regions: RegionCode[];
}) {
  const [lists, setLists] = useState(initialLists);
  const [current, setCurrent] = useState(initialList);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(errorMessage(err));
      }
    });

  const refreshLists = async () => setLists(await api<WatchlistSummaryDTO[]>("/api/watchlists"));

  const select = (id: string) =>
    run(async () => {
      setCurrent(await api<WatchlistDTO>(`/api/watchlists/${id}`));
    });

  const create = () =>
    run(async () => {
      const created = await api<WatchlistSummaryDTO>("/api/watchlists", { method: "POST", json: { name: newName } });
      setNewName("");
      setCreating(false);
      await refreshLists();
      setCurrent(await api<WatchlistDTO>(`/api/watchlists/${created.id}`));
    });

  const removeItem = (instrumentId: string) =>
    run(async () => {
      if (!current) return;
      await api(`/api/watchlists/${current.id}/items/${instrumentId}`, { method: "DELETE" });
      setCurrent(await api<WatchlistDTO>(`/api/watchlists/${current.id}`));
      await refreshLists();
    });

  const makeDefault = () =>
    run(async () => {
      if (!current) return;
      await api(`/api/watchlists/${current.id}`, { method: "PATCH", json: { isDefault: true } });
      await refreshLists();
      setCurrent({ ...current, isDefault: true });
    });

  const deleteList = () =>
    run(async () => {
      if (!current) return;
      if (!window.confirm(`Delete the watchlist "${current.name}"? Its stocks are not affected.`)) return;
      await api(`/api/watchlists/${current.id}`, { method: "DELETE" });
      const remaining = await api<WatchlistSummaryDTO[]>("/api/watchlists");
      setLists(remaining);
      setCurrent(remaining[0] ? await api<WatchlistDTO>(`/api/watchlists/${remaining[0].id}`) : null);
    });

  const visibleItems = current?.items.filter((i) => regions.includes(i.instrument.market.region)) ?? [];
  const hiddenCount = (current?.items.length ?? 0) - visibleItems.length;

  return (
    <Card>
      <CardHeader
        title="Watchlist"
        subtitle="Stocks you are keeping an eye on. Tap one to see its chart."
        right={
          <>
            {pending ? <Loader2 className="size-4 animate-spin text-subtle" aria-label="Loading" /> : null}
            {current?.items.some((i) => i.instrument.quote?.provenance.isSimulated) ? <SimulatedBadge /> : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5 sm:px-5">
        {lists.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => select(l.id)}
            disabled={pending}
            aria-pressed={current?.id === l.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
              current?.id === l.id
                ? "border-accent/40 bg-accent-soft text-accent-strong"
                : "border-line text-muted hover:text-fg"
            }`}
          >
            {l.isDefault ? <Star className="size-3" aria-label="Default" /> : null}
            {l.name}
            <span className="text-subtle">{l.itemCount}</span>
          </button>
        ))}
        {creating ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={40}
              placeholder="List name"
              aria-label="New watchlist name"
              className={`${inputStyles} h-7 w-36 py-0 text-xs`}
            />
            <button type="submit" className={`${buttonStyles.primary} h-7 px-2 py-0 text-xs`} disabled={pending || !newName.trim()}>
              Create
            </button>
            <button type="button" className={buttonStyles.ghost} onClick={() => setCreating(false)} aria-label="Cancel">
              <X className="size-3.5" />
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className={`${buttonStyles.ghost} text-xs`}>
            <Plus className="size-3.5" /> New list
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="border-b border-line bg-down/10 px-5 py-2 text-xs text-down">
          {error}
        </p>
      ) : null}

      {!current ? (
        <EmptyState title="No watchlists yet">Create a list above, then add stocks from Explore.</EmptyState>
      ) : visibleItems.length === 0 ? (
        <EmptyState title={current.items.length ? "Nothing in this market" : "This list is empty"}>
          {current.items.length ? (
            <>All {current.items.length} stocks in this list belong to the other market. Switch the market filter to see them.</>
          ) : (
            <>
              Find stocks in{" "}
              <Link href="/explore" className="text-accent-strong hover:underline">
                Explore
              </Link>{" "}
              and add them here.
            </>
          )}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {visibleItems.map((item) => (
            <InstrumentRow
              key={item.id}
              instrument={item.instrument}
              compact
              actions={
                <button
                  type="button"
                  className={buttonStyles.danger}
                  onClick={() => removeItem(item.instrument.id)}
                  disabled={pending}
                  aria-label={`Remove ${item.instrument.symbol} from ${current.name}`}
                  title="Remove from list"
                >
                  <X className="size-4" />
                </button>
              }
            />
          ))}
        </ul>
      )}

      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-subtle sm:px-5">
          <span>{hiddenCount > 0 ? `${hiddenCount} hidden by market filter` : `${current.items.length} items`}</span>
          <div className="flex items-center gap-1">
            {!current.isDefault ? (
              <button type="button" onClick={makeDefault} disabled={pending} className={`${buttonStyles.ghost} text-xs`}>
                <Star className="size-3.5" /> Make default
              </button>
            ) : null}
            <button type="button" onClick={deleteList} disabled={pending} className={`${buttonStyles.danger} text-xs`}>
              <Trash2 className="size-3.5" /> Delete list
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
