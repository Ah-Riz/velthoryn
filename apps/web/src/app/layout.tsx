import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import "./landing/landing.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { WalletProvider } from "@/components/providers/WalletProvider";
import { WalletTokensProvider } from "@/components/providers/WalletTokensProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Analytics } from "@vercel/analytics/next";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

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
  const analyticsEnabled = process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS === "true";
  return (
    <html lang="en" className={cn(spaceGrotesk.variable, jetbrainsMono.variable, "font-sans", geist.variable)} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <QueryProvider>
            <WalletProvider>
              <WalletTokensProvider>
                <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
              </WalletTokensProvider>
            </WalletProvider>
          </QueryProvider>
        </ThemeProvider>
        {analyticsEnabled ? <Analytics /> : null}
      </body>
    </html>
  );
}
