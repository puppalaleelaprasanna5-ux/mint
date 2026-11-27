"use client";

import { Suspense, useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { NavLinks, NavList } from "./nav-links";
import { Logo } from "./logo";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/95 px-4 backdrop-blur">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Open navigation"
          aria-expanded={open}
        >
          <Menu className="size-5" />
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <nav className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 border-r border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"
                aria-label="Close navigation"
              >
                <X className="size-5" />
              </button>
            </div>
            <Suspense fallback={<NavList pathname="" onNavigate={() => setOpen(false)} />}>
              <NavLinks onNavigate={() => setOpen(false)} />
            </Suspense>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
