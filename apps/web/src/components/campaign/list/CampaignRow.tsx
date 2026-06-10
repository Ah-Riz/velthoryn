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
      className="block rounded-2xl border border-[#222838] bg-[#13161f] p-5 transition-all hover:border-[#7c3aed]/25 hover:bg-[#161a25]"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <RoleBadge role={role} />
            <StatusBadge status={status} />
            <span className="inline-flex items-center rounded-full border border-[#222838] bg-[#161a25] px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-[#64748b]">
              {typeLabel}
            </span>
          </div>

          <div>
            <p className="text-[16px] font-semibold text-[#e5e7eb]">{title}</p>
            <p className="mt-1 font-mono text-[11px] text-[#64748b]">{treeAddress}</p>
            {actionNote ? <div className="mt-2">{actionNote}</div> : null}
          </div>

          <div className={`grid gap-x-6 gap-y-4 border-t border-[#1c2130] pt-4 sm:grid-cols-2 ${columnClass}`}>
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
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#64748b]">Created</p>
          <p className="mt-1 text-[13px] text-[#b4b9c5]">{createdAtLabel}</p>
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
      ? "text-[#e5e7eb]"
      : tone === "accent"
        ? "text-[#14f1d9]"
        : "text-[#b4b9c5]";
  const valueClass =
    tone === "primary"
      ? "text-[15px] font-semibold"
      : tone === "accent"
        ? "text-[15px] font-semibold"
        : "text-[13px] font-medium";

  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#64748b]">{label}</p>
      <p className={`mt-1.5 truncate ${valueClass} ${toneClass} ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </p>
    </div>
  );
}
