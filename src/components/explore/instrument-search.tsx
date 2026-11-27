"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, SearchX } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import type { InstrumentWithQuoteDTO } from "@/lib/types";
import type { MarketFilter } from "@/lib/validation";
import { Card, EmptyState, inputStyles } from "@/components/ui";
import { InstrumentRow } from "@/components/instrument-row";

const REGIONS: { value: MarketFilter; label: string }[] = [
  { value: "ALL", label: "All markets" },
  { value: "IN", label: "India (NSE/BSE)" },
  { value: "US", label: "US (NASDAQ/NYSE)" },
];

const TYPES = [
  { value: "", label: "All types" },
  { value: "EQUITY", label: "Stocks" },
  { value: "INDEX", label: "Indices" },
] as const;

export function InstrumentSearch({
  initialResults,
  initialRegion,
}: {
  initialResults: InstrumentWithQuoteDTO[];
  initialRegion: MarketFilter;
}) {
  const [q, setQ] = useState("");
  const [region, setRegion] = useState<MarketFilter>(initialRegion);
  const [type, setType] = useState<"" | "EQUITY" | "INDEX">("");
  const [results, setResults] = useState(initialResults);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    // Initial results come from the server render; only fetch after the user changes something.
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (q.trim()) params.set("q", q.trim());
      if (region !== "ALL") params.set("region", region);
      if (type) params.set("type", type);
      setLoading(true);
      setError(null);
      try {
        const data = await api<InstrumentWithQuoteDTO[]>(`/api/instruments?${params}`, { signal: controller.signal });
        setResults(data);
      } catch (err) {
        if (!controller.signal.aborted) setError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, region, type]);

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:p-5">
        <label className="relative flex-1">
          <span className="sr-only">Search by symbol or company name</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search symbol or company — e.g. RELIANCE, Apple"
            className={`${inputStyles} pl-9`}
            maxLength={50}
          />
        </label>
        <div className="flex gap-2">
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as MarketFilter)}
            aria-label="Market"
            className={`${inputStyles} w-auto`}
          >
            {REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            aria-label="Instrument type"
            className={`${inputStyles} w-auto`}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-xs text-subtle sm:px-5">
        <span aria-live="polite">
          {loading ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}
        </span>
        {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      </div>

      {error ? (
        <p role="alert" className="mx-4 mb-4 rounded-lg bg-down/10 px-3 py-2 text-sm text-down sm:mx-5">
          {error}
        </p>
      ) : results.length === 0 ? (
        <EmptyState icon={<SearchX className="size-6" />} title="No matches">
          Mint&apos;s demo database has a small set of Indian and US instruments. Try a different symbol, or
          clear the filters.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {results.map((r) => (
            <InstrumentRow key={r.id} instrument={r} />
          ))}
        </ul>
      )}
    </Card>
  );
}
