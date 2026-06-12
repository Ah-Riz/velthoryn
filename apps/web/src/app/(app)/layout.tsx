"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { AppHeader } from "@/components/shell/AppHeader";
import { Toaster } from "@/components/ui/sonner";
import { PendingCampaignIndexer } from "@/components/providers/PendingCampaignIndexer";

const SIDEBAR_KEY = "velthoryn:sidebar-collapsed";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "true") setSidebarCollapsed(true);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  };

  return (
    <>
      <Toaster position="bottom-right" />
      <PendingCampaignIndexer />
      <div className="flex min-h-screen bg-[#0b0d12]">
        <Sidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
        <div
          className={`flex flex-1 flex-col transition-[padding-left] duration-200 ease-in-out ${
            sidebarCollapsed ? "lg:pl-[64px]" : "lg:pl-[240px]"
          }`}
        >
          <AppHeader onMenuToggle={() => setMobileMenuOpen((prev) => !prev)} />
          <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
