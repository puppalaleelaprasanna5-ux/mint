import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Logo } from "@/components/layout/logo";
import { NavLinks, NavList } from "@/components/layout/nav-links";
import { MobileNav } from "@/components/layout/mobile-nav";
import { DataModeBanner, DataModeBannerFallback } from "@/components/layout/data-mode-banner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Mint", template: "%s · Mint" },
  description: "Personal AI-assisted investment research for Indian and US markets.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-dvh">
        <MobileNav />
        <div className="flex">
          <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-5 lg:flex">
            <div className="px-3">
              <Logo />
            </div>
            <nav aria-label="Primary">
              <Suspense fallback={<NavList pathname="" />}>
                <NavLinks />
              </Suspense>
            </nav>
            <p className="mt-auto px-3 text-xs leading-relaxed text-subtle">
              Research tool for personal use. Nothing here is investment advice.
            </p>
          </aside>
          <div className="min-w-0 flex-1">
            <Suspense fallback={<DataModeBannerFallback />}>
              <DataModeBanner />
            </Suspense>
            <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
