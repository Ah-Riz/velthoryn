"use client";

type Props = {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
  isLoading: boolean;
  totalSupply: bigint;
  totalClaimed: bigint;
  vestedAmount: bigint;
};

export function CancelConfirmDialog({
  isOpen,
  onConfirm,
  onClose,
  isLoading,
  totalSupply,
  totalClaimed,
  vestedAmount,
}: Props) {
  if (!isOpen) return null;

  const unclaimedVested = vestedAmount > totalClaimed ? vestedAmount - totalClaimed : 0n;
  const returnedToCreator = totalSupply > vestedAmount ? totalSupply - vestedAmount : 0n;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="rounded-2xl border border-white/[0.08] bg-[#0d1017] p-6 max-w-md w-full mx-4 space-y-5">
        <h3 className="text-[15px] font-semibold text-red-400">
          Cancel this vesting stream?
        </h3>

        <p className="text-[13px] text-[#8b92a5]">
          This action is irreversible. Vesting will freeze at the current moment.
          Recipients can still claim tokens vested up to now.
        </p>

        <div className="space-y-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-[#8b92a5]">Already claimed</span>
            <span className="font-medium text-white">{totalClaimed.toString()} tokens</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b92a5]">Unclaimed vested (claimable by recipient)</span>
            <span className="font-medium text-emerald-400">~{unclaimedVested.toString()} tokens</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b92a5]">Unvested (recoverable after 7-day grace)</span>
            <span className="font-medium text-amber-400">~{returnedToCreator.toString()} tokens</span>
          </div>
        </div>

        <p className="text-[11px] text-[#555d73]">
          Unvested tokens are NOT returned immediately. Use &quot;Withdraw Unvested&quot; after the 7-day grace period.
        </p>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 rounded-xl border border-white/[0.08] py-2.5 text-[13px] text-[#8b92a5] transition hover:bg-white/[0.04] disabled:opacity-50"
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 rounded-xl bg-red-600 py-2.5 text-[13px] font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {isLoading ? "Cancelling..." : "Cancel Stream"}
          </button>
        </div>
      </div>
    </div>
  );
}
