import type { Metadata } from "next";
import "./globals.css";
import "./landing/landing.css";
import { WalletProvider } from "@/components/providers/WalletProvider";
import { WalletTokensProvider } from "@/components/providers/WalletTokensProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Analytics } from "@vercel/analytics/next";

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
          <WalletProvider>
            <WalletTokensProvider>{children}</WalletTokensProvider>
          </WalletProvider>
        </QueryProvider>
        <Analytics />
      </body>
    </html>
  );
}
