"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  BrainCircuit,
  Briefcase,
  FlaskConical,
  LayoutDashboard,
  Newspaper,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { NAV_ITEMS, isActive, type NavItem } from "@/lib/nav";

const ICONS: Record<NavItem["icon"], LucideIcon> = {
  dashboard: LayoutDashboard,
  explore: Search,
  analysis: BrainCircuit,
  news: Newspaper,
  portfolio: Briefcase,
  paper: FlaskConical,
  alerts: Bell,
  settings: Settings,
};

/** Active-state aware nav. Must be rendered inside <Suspense> (usePathname is runtime data). */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

/** Pure nav list; with an empty pathname it doubles as the prerendered Suspense fallback. */
export function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent-soft text-accent-strong"
                  : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.phase ? (
                <span className="rounded border border-line px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-subtle">
                  Soon
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
