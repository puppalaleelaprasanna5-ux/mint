/** Primary navigation. `phase` marks sections whose features land in a later development phase. */
export interface NavItem {
  href: string;
  label: string;
  icon: "dashboard" | "explore" | "analysis" | "news" | "portfolio" | "paper" | "alerts" | "settings";
  phase?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/explore", label: "Explore Stocks", icon: "explore" },
  { href: "/analysis", label: "AI Analysis", icon: "analysis", phase: 3 },
  { href: "/news", label: "Market News", icon: "news", phase: 4 },
  { href: "/portfolio", label: "My Portfolio", icon: "portfolio", phase: 5 },
  { href: "/paper-trading", label: "Paper Trading", icon: "paper", phase: 6 },
  { href: "/alerts", label: "Smart Alerts", icon: "alerts" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
