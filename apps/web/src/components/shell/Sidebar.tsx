"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useNeedsActionCount } from "@/hooks/useNeedsActionCount";
import { clusterLabel, clusterNetworkLabel } from "@/lib/sol/cluster";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
  },
  {
    href: "/campaign/create",
    label: "Create Stream",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    ),
  },
  {
    href: "/campaigns",
    label: "My Campaigns",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    href: "/activity",
    label: "Activity",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { count: needsActionCount, isLoading: needsActionLoading } = useNeedsActionCount();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <div className="flex h-16 items-center gap-2.5 border-b border-[#1c2130] px-5">
        <img src="/brand/velthoryn-logo-sm.svg" alt="Velthoryn" className="h-8 w-8" />
        <span className="text-[15px] font-semibold tracking-tight text-[#e5e7eb]">Velthoryn</span>
        <span className="ml-auto rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] font-medium tracking-[0.08em] text-emerald-400">
          {clusterLabel().toLowerCase()}
        </span>
      </div>

      <nav data-sidebar-nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = mounted && (
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href)) ||
              // Highlight "My Campaigns" when viewing a campaign detail (not create)
              (item.href === "/campaigns" && pathname.startsWith("/campaign/") && !pathname.startsWith("/campaign/create"))
            );

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavClick}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all ${
                    isActive
                      ? "border border-[#7c3aed]/25 bg-[#7c3aed]/12 text-[#a78bfa]"
                      : "border border-transparent text-[#64748b] hover:border-[#222838] hover:bg-[#13161f] hover:text-[#b4b9c5]"
                  }`}
                >
                  <span className={isActive ? "text-[#a78bfa]" : "text-[#64748b]"}>
                    {item.icon}
                  </span>
                  {item.label}
                  {item.href === "/campaigns" && needsActionCount > 0 && !needsActionLoading && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-[#1c2130] px-4 py-4">
        <div className="flex items-center gap-2 rounded-lg border border-[#1c2130] bg-[#0b0d12] px-3 py-2.5 font-mono text-[10px] tracking-[0.06em] text-[#64748b]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          {clusterNetworkLabel()}
        </div>
      </div>
    </>
  );
}

export function Sidebar({ mobileOpen, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const pathname = usePathname();

  useEffect(() => {
    onMobileClose?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-[240px] flex-col border-r border-[#1c2130] bg-[#0b0d12] lg:flex">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={onMobileClose}
          />
          <aside className="fixed left-0 top-0 z-50 flex h-screen w-[280px] flex-col border-r border-[#1c2130] bg-[#0b0d12] lg:hidden">
            <SidebarContent onNavClick={onMobileClose} />
          </aside>
        </>
      )}
    </>
  );
}
