"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { useVestingProgressSummary } from "@/hooks/useVestingProgress";
import { useCampaignList } from "@/hooks/useCampaignList";
import { useMintDecimals } from "@/hooks/useMintDecimals";

export default function ActivityPage() {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();

  const senderQuery = useCampaignList(
    walletAddress ? { creator: walletAddress, limit: 200 } : undefined,
  );
  const { campaigns: vestingCampaigns } = useVestingProgressSummary(walletAddress);

  const mintAddresses = useMemo(() => {
    const senderMints = (
      (senderQuery.data?.campaigns ?? []) as Array<{ mint: string }>
    )
      .map((c) => c.mint)
      .filter(Boolean);
    const vestingMints = vestingCampaigns.map((c) => c.mint).filter(Boolean);
    return [...new Set([...senderMints, ...vestingMints])];
  }, [senderQuery.data?.campaigns, vestingCampaigns]);

  const { decimalsMap } = useMintDecimals(mintAddresses);

  const activityMintDecimals = useMemo(() => {
    if (mintAddresses.length === 0) return null;
    const vals = mintAddresses.map((m) => decimalsMap.get(m));
    if (vals.some((d) => d === undefined)) return null;
    const unique = new Set(vals);
    return unique.size === 1 ? (vals[0] ?? null) : null;
  }, [mintAddresses, decimalsMap]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-primary/70">
          History
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Activity</h1>
        <p className="mt-1 font-mono text-[12px] text-muted-foreground">
          All on-chain events across your campaigns
        </p>
      </div>

      {!walletAddress ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-muted/60 px-8 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-accent-light">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </div>
          <h2 className="mt-4 text-[15px] font-medium text-foreground">No wallet connected</h2>
          <p className="mt-2 font-mono text-[13px] text-muted-foreground">
            Connect your Solana wallet to view activity history.
          </p>
        </div>
      ) : (
        <ActivityFeed
          address={walletAddress}
          limit={50}
          mintDecimals={activityMintDecimals}
        />
      )}
    </div>
  );
}
