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
      className="block rounded-xl sm:rounded-2xl border border-line bg-muted p-3.5 sm:p-5 transition-all hover:border-primary/25 hover:bg-surface-hover"
    >
      <div className="flex flex-col gap-3 sm:gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2.5 sm:space-y-4 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <RoleBadge role={role} />
            <StatusBadge status={status} />
            <span className="inline-flex items-center rounded-full border border-line bg-surface-hover px-2 py-0.5 sm:px-2.5 sm:py-1 font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
              {typeLabel}
            </span>
          </div>

          <div className="min-w-0">
            <p className="text-[14px] sm:text-[16px] font-semibold text-foreground truncate">{title}</p>
            <p className="mt-0.5 sm:mt-1 font-mono text-[10px] sm:text-[11px] text-muted-foreground truncate">{treeAddress}</p>
            {actionNote ? <div className="mt-1.5 sm:mt-2">{actionNote}</div> : null}
          </div>

          <div className={`grid gap-x-4 sm:gap-x-6 gap-y-2.5 sm:gap-y-4 border-t border-border pt-2.5 sm:pt-4 grid-cols-2 sm:grid-cols-2 ${columnClass}`}>
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
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Created</p>
          <p className="mt-0.5 sm:mt-1 text-[12px] sm:text-[13px] text-secondary-foreground">{createdAtLabel}</p>
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
      ? "text-foreground"
      : tone === "accent"
        ? "text-violet"
        : "text-secondary-foreground";
  const valueClass =
    tone === "primary"
      ? "text-[13px] sm:text-[15px] font-semibold"
      : tone === "accent"
        ? "text-[13px] sm:text-[15px] font-semibold"
        : "text-[12px] sm:text-[13px] font-medium";

  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`mt-1 sm:mt-1.5 truncate ${valueClass} ${toneClass} ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </p>
    </div>
  );
}
