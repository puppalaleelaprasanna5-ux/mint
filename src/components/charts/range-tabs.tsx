"use client";

import { RANGES, type RangeKey } from "./chart-theme";

export function RangeTabs({
  value,
  onChange,
  available,
}: {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
  /** Number of bars available; ranges needing more than this are hidden (except All). */
  available: number;
}) {
  return (
    <div role="tablist" aria-label="Chart range" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {RANGES.filter((r) => r.key === "ALL" || r.bars <= available).map((r) => (
        <button
          key={r.key}
          type="button"
          role="tab"
          aria-selected={value === r.key}
          onClick={() => onChange(r.key)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            value === r.key ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function sliceForRange<T>(items: T[], key: RangeKey): T[] {
  const range = RANGES.find((r) => r.key === key);
  if (!range || !Number.isFinite(range.bars)) return items;
  return items.slice(-(range.bars + 1)); // +1 so the change covers the full range
}
