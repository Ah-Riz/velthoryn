"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { StreamStatus } from "@/lib/vesting/list";
import { RoleBadge } from "./RoleBadge";
import { StatusBadge } from "./StatusBadge";

type Props = {
  treeAddress: string;
  role: "sender" | "recipient" | "both";
  status: StreamStatus;
  typeLabel: string;
  title: string;
  amountLabel: string;
  amountDisplay: string;
  secondaryAmountLabel?: string;
  secondaryAmountDisplay?: string | null;
  claimableDisplay?: string | null;
  counterpartyLabel: string;
  counterpartyValue: string;
  mintValue: string;
  nextLabel: string;
  nextValue: string;
  createdAtLabel: string;
  actionNote?: ReactNode;
};

export function CampaignRow({
  treeAddress,
  role,
  status,
  typeLabel,
  title,
  amountLabel,
  amountDisplay,
  secondaryAmountLabel,
  secondaryAmountDisplay,
  claimableDisplay,
  counterpartyLabel,
  counterpartyValue,
  mintValue,
  nextLabel,
  nextValue,
  createdAtLabel,
  actionNote,
}: Props) {
  const hasClaimable = claimableDisplay !== null && claimableDisplay !== undefined;
  const hasSecondaryAmount =
    secondaryAmountLabel !== undefined &&
    secondaryAmountDisplay !== null &&
    secondaryAmountDisplay !== undefined;
  const columnClass = hasClaimable && hasSecondaryAmount
    ? "xl:grid-cols-6"
    : hasClaimable || hasSecondaryAmount
      ? "xl:grid-cols-5"
      : "xl:grid-cols-4";

  return (
    <Link
      href={`/campaign/${treeAddress}`}
      className="block rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition hover:bg-white/[0.03]"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <RoleBadge role={role} />
            <StatusBadge status={status} />
            <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-[#8b92a5]">
              {typeLabel}
            </span>
          </div>

          <div>
            <p className="text-[16px] font-semibold text-white">{title}</p>
            <p className="mt-1 font-mono text-[12px] text-[#8b92a5]">{treeAddress}</p>
            {actionNote ? <div className="mt-2">{actionNote}</div> : null}
          </div>

          <div className={`grid gap-x-6 gap-y-4 border-t border-white/[0.06] pt-4 sm:grid-cols-2 ${columnClass}`}>
            <InfoBlock label={amountLabel} value={amountDisplay} tone="primary" />
            {hasSecondaryAmount ? (
              <InfoBlock label={secondaryAmountLabel} value={secondaryAmountDisplay} />
            ) : null}
            {hasClaimable ? <InfoBlock label="Claimable Now" value={claimableDisplay} tone="accent" /> : null}
            <InfoBlock label={counterpartyLabel} value={counterpartyValue} />
            <InfoBlock label="Mint" value={mintValue} mono />
            <InfoBlock label={nextLabel} value={nextValue} />
          </div>
        </div>

        <div className="text-left lg:text-right">
          <p className="text-[12px] text-[#8b92a5]">Created</p>
          <p className="mt-1 text-[13px] text-white">{createdAtLabel}</p>
        </div>
      </div>
    </Link>
  );
}

function InfoBlock({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "default" | "primary" | "accent";
}) {
  const toneClass =
    tone === "primary"
      ? "text-white"
      : tone === "accent"
        ? "text-emerald-300"
        : "text-white";
  const valueClass =
    tone === "primary"
      ? "text-[15px] font-semibold"
      : tone === "accent"
        ? "text-[15px] font-semibold"
        : "text-[13px] font-medium";

  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[#6f7c95]">{label}</p>
      <p className={`mt-1.5 truncate ${valueClass} ${toneClass} ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </p>
    </div>
  );
}
