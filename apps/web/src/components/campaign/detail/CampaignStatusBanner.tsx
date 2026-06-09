"use client";

import { getGracePeriodState } from "@/lib/vesting/display";
import { GracePeriodCountdown } from "./GracePeriodCountdown";

type CampaignStatusBannerProps = {
  cancelledAtBigint: bigint | null;
  isCreator: boolean;
  isInstantRefunded: boolean;
  isFunded: boolean;
  nowTs: bigint;
  onWithdrawClick: () => void;
  onResumeFunding?: () => void;
  unvestedAmount?: bigint;
  mintDecimals?: number | null;
  isWithdrawn?: boolean;
};

function formatTokenAmount(raw: bigint, decimals: number | null | undefined): string {
  if (decimals === null || decimals === undefined) return raw.toString();
  if (decimals === 0) return raw.toLocaleString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

export function CampaignStatusBanner({
  cancelledAtBigint,
  isCreator,
  isInstantRefunded,
  isFunded,
  nowTs,
  onWithdrawClick,
  onResumeFunding,
  unvestedAmount,
  mintDecimals,
  isWithdrawn,
}: CampaignStatusBannerProps) {
  if (!isCreator) return null;

  if (isInstantRefunded) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
        <p className="text-[13px] font-medium text-emerald-400">
          Campaign refunded before vesting started
        </p>
        <p className="mt-1.5 text-[12px] leading-6 text-emerald-300/70">
          All tokens were returned to your wallet.
        </p>
      </div>
    );
  }

  if (cancelledAtBigint !== null) {
    const graceState = getGracePeriodState(cancelledAtBigint, nowTs);

    if (graceState.status === "grace_active") {
      const cancelDate = new Date(Number(cancelledAtBigint) * 1000).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      return (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
          <p className="text-[13px] font-medium text-amber-400">
            Campaign cancelled on {cancelDate}
          </p>
          <p className="mt-1.5 text-[12px] leading-6 text-amber-300/70">
            Grace period expires in{" "}
            <GracePeriodCountdown
              cancelledAt={cancelledAtBigint}
              className="text-[12px]"
              showPrefix={false}
            />
            . Recipients can still claim vested tokens.
          </p>
        </div>
      );
    }

    const showAsWithdrawn =
      isWithdrawn ?? (unvestedAmount !== undefined && unvestedAmount === 0n);

    if (showAsWithdrawn) {
      return (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
          <p className="text-[13px] font-medium text-emerald-400">Campaign settled</p>
          <p className="mt-1.5 text-[12px] leading-6 text-emerald-300/70">
            Unvested tokens have been withdrawn to your wallet.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4">
        <p className="text-[13px] font-medium text-red-400">Grace period has expired</p>
        <p className="mt-1.5 text-[12px] leading-6 text-red-300/70">
          {unvestedAmount !== undefined
            ? `You can now withdraw ${formatTokenAmount(unvestedAmount, mintDecimals)} unvested tokens.`
            : "You can now withdraw your unvested tokens."}
        </p>
        <button
          type="button"
          onClick={onWithdrawClick}
          className="mt-3 w-full rounded-xl border border-amber-500/20 bg-amber-600 px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-amber-500"
        >
          Withdraw Unvested Tokens
        </button>
      </div>
    );
  }

  if (!isFunded) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
        <p className="text-[13px] font-medium text-amber-400">Campaign created but not yet funded</p>
        {onResumeFunding && (
          <button
            type="button"
            onClick={onResumeFunding}
            className="mt-3 w-full rounded-xl border border-amber-500/20 bg-amber-400 px-4 py-2.5 text-[13px] font-semibold text-black transition hover:opacity-90"
          >
            Resume Funding
          </button>
        )}
      </div>
    );
  }

  return null;
}
