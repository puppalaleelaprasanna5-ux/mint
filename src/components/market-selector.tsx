import Link from "next/link";
import type { MarketFilter } from "@/lib/validation";

const OPTIONS: { value: MarketFilter; label: string }[] = [
  { value: "ALL", label: "All markets" },
  { value: "IN", label: "India" },
  { value: "US", label: "US" },
];

/** Market filter as plain links (`?market=`), so it works without client JS and is shareable. */
export function MarketSelector({ value, basePath }: { value: MarketFilter; basePath: string }) {
  return (
    <nav aria-label="Market" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {OPTIONS.map((o) => {
        const active = o.value === value;
        const href = o.value === "ALL" ? basePath : `${basePath}?market=${o.value}`;
        return (
          <Link
            key={o.value}
            href={href}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              active ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-fg"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
