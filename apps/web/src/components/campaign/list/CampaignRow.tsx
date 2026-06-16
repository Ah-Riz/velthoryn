"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { StreamStatus } from "@/lib/vesting/list";
import { RoleBadge } from "./RoleBadge";
import { StatusBadge, TypeBadge } from "./StatusBadge";

type Props = {
  treeAddress: string;
  role: "sender" | "recipient" | "both";
  status: StreamStatus;
  typeLabel: string;
  title: string;
  mintSymbol: string;
  mintName: string;
  mintLogoURI?: string;
  amountLabel: string;
  amountDisplay: string;
  secondaryAmountLabel?: string;
  secondaryAmountDisplay?: string | null;
  claimableDisplay?: string | null;
  claimableUsd?: number | null;
  usdValue?: number | null;
  progressPct?: number;
  counterpartyLabel: string;
  counterpartyValue: string;
  mintValue: string;
  nextLabel: string;
  nextValue: string;
  createdAtLabel: string;
  actionNote?: ReactNode;
};

function TokenLogo({ logoURI, symbol }: { logoURI?: string; symbol: string }) {
  const [err, setErr] = useState(false);
  if (logoURI && !err) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoURI}
        alt={symbol}
        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-accent-light ring-1 ring-white/10">
      {symbol.slice(0, 2)}
    </div>
  );
}

function resolveClaimable(
  claimableDisplay: string | null | undefined,
  status: StreamStatus,
  mintSymbol: string,
): { text: string; variant: "green" | "muted" | "completed" } | null {
  if (claimableDisplay === null || claimableDisplay === undefined) return null;
  if (status === "Claimed") return { text: "Fully Claimed", variant: "completed" };
  if (claimableDisplay === "0") return { text: `0 ${mintSymbol}`, variant: "muted" };
  return { text: `${claimableDisplay} ${mintSymbol}`, variant: "green" };
}

export function CampaignRow({
  treeAddress,
  role,
  status,
  typeLabel,
  title,
  mintSymbol,
  mintName,
  mintLogoURI,
  amountLabel,
  amountDisplay,
  secondaryAmountLabel,
  secondaryAmountDisplay,
  claimableDisplay,
  claimableUsd,
  usdValue,
  progressPct,
  counterpartyLabel,
  counterpartyValue,
  mintValue,
  nextLabel,
  nextValue,
  createdAtLabel,
  actionNote,
}: Props) {
  const claimable = resolveClaimable(claimableDisplay, status, mintSymbol);
  const showProgress = progressPct !== undefined && progressPct > 0;

  return (
    <Link
      href={`/campaign/${treeAddress}`}
      className="group block rounded-xl sm:rounded-2xl border border-line bg-muted p-4 sm:p-5 transition-all duration-200 hover:border-primary/30 hover:bg-surface-hover hover:shadow-[0_0_20px_-6px_rgba(124,58,237,0.15)]"
    >
      {/* ── Row: Token Info + Badges + Date ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenLogo logoURI={mintLogoURI} symbol={mintSymbol} />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-[15px] font-semibold leading-tight text-foreground truncate">
                {title}
              </p>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-secondary-foreground">{mintSymbol}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[120px] sm:max-w-none">{mintName}</span>
            </div>
          </div>
        </div>

        {/* Right: date */}
        <div className="shrink-0 text-right">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Created</p>
          <p className="mt-0.5 text-[12px] text-secondary-foreground">{createdAtLabel}</p>
        </div>
      </div>

      {/* ── Badges ── */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <RoleBadge role={role} />
        <StatusBadge status={status} />
        <TypeBadge typeLabel={typeLabel} />
        {actionNote && <div className="ml-1">{actionNote}</div>}
      </div>

      {/* ── Progress bar ── */}
      {showProgress && (
        <div className="mt-3.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground">
              {role === "recipient" ? "Claimed" : "Distributed"}
            </span>
            <span className="font-mono text-[10px] text-secondary-foreground">
              {progressPct}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
            <div
              className={`h-full rounded-full transition-all ${
                status === "Claimed"
                  ? "bg-emerald-500/70"
                  : status === "Claimable"
                    ? "bg-emerald-400/80"
                    : "bg-primary/50"
              }`}
              style={{ width: `${Math.min(100, progressPct)}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Data grid ── */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {/* Allocation */}
        <InfoBlock
          label={amountLabel}
          value={`${amountDisplay} ${mintSymbol}`}
          sub={usdValue != null ? `≈$${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined}
          tone="primary"
        />

        {/* Total Supply (for recipient rows) */}
        {secondaryAmountLabel && secondaryAmountDisplay ? (
          <InfoBlock
            label={secondaryAmountLabel}
            value={`${secondaryAmountDisplay} ${mintSymbol}`}
          />
        ) : null}

        {/* Claimable */}
        {claimable !== null && (
          <InfoBlock
            label="Claimable Now"
            value={claimable.text}
            sub={claimableUsd != null && claimable.variant === "green"
              ? `≈$${claimableUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : undefined}
            tone={
              claimable.variant === "green"
                ? "claimable"
                : claimable.variant === "completed"
                  ? "completed"
                  : "default"
            }
          />
        )}

        {/* Counterparty */}
        <InfoBlock
          label={counterpartyLabel}
          value={counterpartyValue}
          mono
        />

        {/* Mint address */}
        <InfoBlock label="Mint" value={mintValue} mono />

        {/* Release/next */}
        <InfoBlock label={nextLabel} value={nextValue} />
      </div>
    </Link>
  );
}

function InfoBlock({
  label,
  value,
  sub,
  mono,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  tone?: "default" | "primary" | "claimable" | "completed";
}) {
  const valueClass =
    tone === "primary"
      ? "text-[13px] sm:text-[14px] font-semibold text-foreground"
      : tone === "claimable"
        ? "text-[13px] sm:text-[14px] font-semibold text-emerald-400"
        : tone === "completed"
          ? "text-[13px] sm:text-[14px] font-medium text-emerald-500/80"
          : "text-[12px] sm:text-[13px] font-medium text-secondary-foreground";

  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 truncate ${valueClass} ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">{sub}</p>
      )}
    </div>
  );
}
