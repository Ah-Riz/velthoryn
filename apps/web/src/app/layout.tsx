import type { Metadata } from "next";
import "./globals.css";
import "./landing/landing.css";
import { WalletProvider } from "@/components/providers/WalletProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";

export const metadata: Metadata = {
  title: "Velthoryn",
  description: "Merkle-compressed token vesting on Solana",
  icons: {
    icon: [
      { url: "/brand/velthoryn-logo-sm.svg", type: "image/svg+xml" },
    ],
    shortcut: "/brand/velthoryn-logo-sm.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <QueryProvider>
          <WalletProvider>{children}</WalletProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
