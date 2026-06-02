"use client";

import type { WalletTokenOption } from "@/lib/token/normalize";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import type { PendingCampaignFundingPayload } from "@/lib/stream/persist";
import { CARD, SectionHeader, formatTokenAmount } from "./shared";

type PendingFundingsPanelProps = {
  items: PendingCampaignFundingPayload[];
  walletTokens: WalletTokenOption[];
  onResume: (pending: PendingCampaignFundingPayload) => void;
};

function formatPendingAmount(
  pending: PendingCampaignFundingPayload,
  walletTokens: WalletTokenOption[],
) {
  const popularToken = POPULAR_TOKENS.find((token) => token.mint === pending.mint);
  if (popularToken) {
    return `${formatTokenAmount(pending.totalSupply, popularToken.decimals)} ${popularToken.symbol}`;
  }

  const walletToken = walletTokens.find((token) => token.mintAddress === pending.mint);
  if (walletToken?.decimals !== null && walletToken?.decimals !== undefined) {
    return `${formatTokenAmount(pending.totalSupply, walletToken.decimals)} ${pending.mint.slice(0, 4)}...${pending.mint.slice(-4)}`;
  }

  return pending.totalSupply;
}

export function PendingFundingsPanel({
  items,
  walletTokens,
  onResume,
}: PendingFundingsPanelProps) {
  if (items.length === 0) return null;

  return (
    <div className={`${CARD} space-y-3 p-5`}>
      <SectionHeader
        title="Unfunded Campaigns"
        caption="These campaigns were created on-chain but funding was not completed."
      />
      {items.map((pending) => (
        <div
          key={pending.treeAddress}
          className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4"
        >
          <p className="break-all font-mono text-[11px] text-amber-100">
            {pending.treeAddress}
          </p>
          <p className="mt-2 text-[12px] text-amber-200/80">
            Total to fund: {formatPendingAmount(pending, walletTokens)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onResume(pending)}
              className="rounded-lg bg-amber-400 px-3 py-2 text-[12px] font-semibold text-black"
            >
              Resume funding
            </button>
            <a
              href={`/campaign/${pending.treeAddress}`}
              className="rounded-lg border border-white/[0.12] px-3 py-2 text-[12px] font-medium text-white"
            >
              View campaign
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
