"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useNeedsActionCount } from "@/hooks/useNeedsActionCount";

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

function SidebarContent({
  onNavClick,
  collapsed,
  onToggleCollapse,
}: {
  onNavClick?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { count: needsActionCount, isLoading: needsActionLoading } = useNeedsActionCount();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      {/* Header */}
      <div className={`flex h-16 items-center border-b border-[#1c2130] ${collapsed ? "justify-center" : "gap-2.5 px-4"}`}>
        {collapsed ? (
          /* Collapsed: whole logo area = clickable expand button, hover reveals icon */
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-150 hover:bg-[#13161f] active:scale-95"
          >
            <img
              src="/brand/velthoryn-logo-sm.svg"
              alt=""
              className="h-7 w-7 shrink-0 transition-opacity duration-150 group-hover:opacity-0"
            />
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 7l5 5-5 5" />
                <path d="M6 7l5 5-5 5" />
              </svg>
            </span>
          </button>
        ) : (
          /* Expanded: logo + text + collapse/close button */
          <>
            <img src="/brand/velthoryn-logo-sm.svg" alt="Velthoryn" className="h-8 w-8 shrink-0" />
            <span className="text-[15px] font-semibold tracking-tight text-[#e5e7eb]">Velthoryn</span>
            <button
              type="button"
              onClick={onNavClick ?? onToggleCollapse}
              aria-label={onNavClick ? "Close sidebar" : "Collapse sidebar"}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] transition-all duration-150 hover:bg-[#13161f] hover:text-[#a78bfa] active:scale-95"
            >
              {onNavClick ? (
                /* Mobile: X close */
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                /* Desktop: double chevron left = collapse */
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 17l-5-5 5-5" />
                  <path d="M18 17l-5-5 5-5" />
                </svg>
              )}
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav data-sidebar-nav className="flex-1 overflow-y-auto px-2 py-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = mounted && (
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href)) ||
              (item.href === "/campaigns" && pathname.startsWith("/campaign/") && !pathname.startsWith("/campaign/create"))
            );
            const showBadge = item.href === "/campaigns" && needsActionCount > 0 && !needsActionLoading;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavClick}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={`flex items-center rounded-lg transition-all ${
                    collapsed
                      ? "mx-auto h-11 w-11 justify-center"
                      : "gap-3 px-3 py-2.5 text-[13px] font-medium"
                  } ${
                    isActive
                      ? "border border-[#7c3aed]/25 bg-[#7c3aed]/12 text-[#a78bfa]"
                      : "border border-transparent text-[#64748b] hover:border-[#222838] hover:bg-[#13161f] hover:text-[#b4b9c5]"
                  }`}
                >
                  <span className={`relative shrink-0 ${isActive ? "text-[#a78bfa]" : "text-[#64748b]"}`}>
                    {item.icon}
                    {showBadge && collapsed && (
                      <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
                    )}
                  </span>
                  {!collapsed && (
                    <>
                      {item.label}
                      {showBadge && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
                      )}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

    </>
  );
}

export function Sidebar({
  mobileOpen,
  onMobileClose,
  collapsed,
  onToggleCollapse,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    onMobileClose?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`fixed left-0 top-0 z-30 hidden h-screen flex-col border-r border-[#1c2130] bg-[#0b0d12] transition-[width] duration-200 ease-in-out lg:flex ${
          collapsed ? "w-[64px]" : "w-[240px]"
        }`}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />
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
