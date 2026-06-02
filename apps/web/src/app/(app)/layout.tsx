"use client";

import { useState } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { AppHeader } from "@/components/shell/AppHeader";
import { ToastProvider } from "@/components/shell/Toast";
import { PendingCampaignIndexer } from "@/components/providers/PendingCampaignIndexer";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <ToastProvider>
      <PendingCampaignIndexer />
      <div className="flex min-h-screen bg-[#0b0d12]">
        <Sidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />
        <div className="flex flex-1 flex-col lg:pl-[240px]">
          <AppHeader onMenuToggle={() => setMobileMenuOpen((prev) => !prev)} />
          <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
