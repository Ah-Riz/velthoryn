"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/campaign/list/StatusBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { VestingProgressCampaign } from "@/hooks/useVestingProgress";
import {
  formatCountdown,
  getVestingTypeBadgeColor,
  getVestingTypeLabel,
} from "@/lib/vesting/display";
import { truncateAddress } from "@/lib/vesting/timeline-helpers";
import type { StreamStatus } from "@/lib/vesting/list";

export interface CampaignCardData {
  address: string;
  name: string;
  typeLabel: string;
  typeBadgeColor: string;
  status: StreamStatus;
  progressPercent: number;
  progressColorClass: string;
  entitled: string;
  vested: string;
  claimed: string;
  claimable: string;
  hasClaimable: boolean;
  nextUnlock: string;
}

export interface CampaignCardProps {
  campaign: CampaignCardData;
}

function getCampaignStatus(campaign: VestingProgressCampaign): StreamStatus {
  const claimable = BigInt(campaign.progress.claimable);
  const entitled = BigInt(campaign.progress.totalEntitled);
  const claimed = BigInt(campaign.progress.claimedSoFar);

  if (entitled > 0n && claimed >= entitled) return "Claimed";
  if (campaign.cancelledAt !== null) return "Cancelled";
  if (campaign.paused) return "Paused";
  if (claimable > 0n) return "Claimable";
  if (campaign.leaf.releaseType === 2 && !campaign.milestoneReleased) return "Scheduled";
  return "Active";
}

function formatNextUnlock(
  campaign: VestingProgressCampaign,
  nowTs: bigint,
): string {
  if (campaign.leaf.releaseType === 2 && !campaign.milestoneReleased) {
    return "Milestone not released";
  }
  if (!campaign.progress.nextUnlock) return "Fully vested";
  return formatCountdown(BigInt(campaign.progress.nextUnlock), nowTs);
}

export function toCampaignCardData(
  campaign: VestingProgressCampaign,
  nowTs: bigint,
  fmtAmount: (raw: bigint, campaign: VestingProgressCampaign) => string,
): CampaignCardData {
  const claimable = BigInt(campaign.progress.claimable);
  const status = getCampaignStatus(campaign);

  return {
    address: campaign.treeAddress,
    name: campaign.metadata?.name ?? truncateAddress(campaign.treeAddress),
    typeLabel: getVestingTypeLabel(campaign.leaf.releaseType),
    typeBadgeColor: getVestingTypeBadgeColor(campaign.leaf.releaseType),
    status,
    progressPercent: campaign.progress.progressPercent,
    progressColorClass:
      claimable > 0n ? "bg-emerald-500" : status === "Claimed" ? "bg-sky-500" : "bg-violet-500",
    entitled: fmtAmount(BigInt(campaign.progress.totalEntitled), campaign),
    vested: fmtAmount(BigInt(campaign.progress.vestedSoFar), campaign),
    claimed: fmtAmount(BigInt(campaign.progress.claimedSoFar), campaign),
    claimable: fmtAmount(claimable, campaign),
    hasClaimable: claimable > 0n,
    nextUnlock: formatNextUnlock(campaign, nowTs),
  };
}

export function CampaignCard({ campaign }: CampaignCardProps) {
  return (
    <Link
      href={`/campaign/${campaign.address}`}
      className="group block rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:border-violet-500/20 hover:bg-violet-500/[0.03]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-medium text-white group-hover:text-violet-300">
            {campaign.name}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${campaign.typeBadgeColor}`}
          >
            {campaign.typeLabel}
          </span>
          <StatusBadge status={campaign.status} />
        </div>
      </div>

      <ProgressBar
        percentage={campaign.progressPercent}
        showLabel
        className="mt-4"
        colorClass={campaign.progressColorClass}
      />

      <div className="mt-4 grid gap-2 text-[12px] sm:grid-cols-2">
        <div className="text-[#8b92a5]">
          Entitled: <span className="text-white">{campaign.entitled}</span>
        </div>
        <div className="text-[#8b92a5]">
          Vested: <span className="text-white">{campaign.vested}</span>
        </div>
        <div className="text-[#8b92a5]">
          Claimed: <span className="text-white">{campaign.claimed}</span>
        </div>
        <div className="text-[#8b92a5]">
          Claimable: <span className={campaign.hasClaimable ? "text-emerald-400" : "text-white"}>
            {campaign.claimable}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-[#555d73]">
          Next unlock: {campaign.nextUnlock}
        </span>
        {campaign.hasClaimable && (
          <span className="text-[12px] font-medium text-emerald-400">
            Claim →
          </span>
        )}
      </div>
    </Link>
  );
}
