"use client";

import { Sidebar } from "@/components/shell/Sidebar";
import { AppHeader } from "@/components/shell/AppHeader";
import { ToastProvider } from "@/components/shell/Toast";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-[#0b0d12]">
        <Sidebar />
        <div className="flex flex-1 flex-col pl-[240px]">
          <AppHeader />
          <main className="flex-1 px-6 py-6 lg:px-10 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
