"use client";

import { useState } from "react";

export interface RecipientListModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipients: Array<{
    beneficiary: string;
    allocation: string;
    leafCount: number;
    claimedAmount: string;
  }>;
  mintDecimals: number | null;
  viewer?: string;
}

export function RecipientListModal({
  isOpen,
  onClose,
  recipients,
  mintDecimals,
  viewer,
}: RecipientListModalProps) {
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  if (!isOpen) return null;

  const formatAmount = (raw: string) => {
    const value = BigInt(raw);
    if (mintDecimals === null) return value.toString();
    if (mintDecimals === 0) return value.toLocaleString();
    const divisor = 10n ** BigInt(mintDecimals);
    const whole = value / divisor;
    const frac = value % divisor;
    const fracStr = frac.toString().padStart(mintDecimals, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
  };
  const filteredRecipients = recipients.filter((recipient) =>
    recipient.beneficiary.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function handleCopy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      window.setTimeout(() => {
        setCopied((current) => (current === address ? null : current));
      }, 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-white/[0.08] bg-[#0d1117] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[20px] font-semibold text-white">Recipients</h3>
            <p className="mt-1 text-[13px] text-[#8b92a5]">
              Latest recipient list from the current campaign root.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-white transition hover:bg-white/[0.06]"
          >
            Close
          </button>
        </div>

        <div className="mt-5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipient wallet"
            className="w-full rounded-2xl border border-white/[0.08] bg-[#11161f] px-4 py-3 text-[13px] text-white outline-none transition focus:border-white/20"
          />
        </div>

        <div className="mt-5 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {filteredRecipients.map((recipient) => {
            const allocation = BigInt(recipient.allocation);
            const claimedAmount = BigInt(recipient.claimedAmount);
            const fullyClaimed = claimedAmount >= allocation && allocation > 0n;
            const partiallyClaimed = claimedAmount > 0n && claimedAmount < allocation;

            return (
            <div
              key={recipient.beneficiary}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-mono text-[13px] text-white" title={recipient.beneficiary}>
                      {recipient.beneficiary}
                    </p>
                    {viewer === recipient.beneficiary && (
                      <span className="inline-flex items-center rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                        You
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        fullyClaimed
                          ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                          : partiallyClaimed
                            ? "border border-amber-500/20 bg-amber-500/10 text-amber-300"
                            : "border border-white/[0.08] bg-white/[0.03] text-[#8b92a5]"
                      }`}
                    >
                      {fullyClaimed ? "Fully claimed" : partiallyClaimed ? "Partially claimed" : "Unclaimed"}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-[#6f7c95]">
                    {recipient.leafCount} {recipient.leafCount === 1 ? "allocation" : "allocations"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(recipient.beneficiary)}
                  className="shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-white transition hover:bg-white/[0.06]"
                >
                  {copied === recipient.beneficiary ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/[0.06] bg-[#11161f] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[#6f7c95]">Allocation</p>
                  <p className="mt-1.5 text-[14px] font-medium text-white">{formatAmount(recipient.allocation)}</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-[#11161f] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[#6f7c95]">Claimed</p>
                  <p className="mt-1.5 text-[14px] font-medium text-white">{formatAmount(recipient.claimedAmount)}</p>
                </div>
              </div>
            </div>
          )})}

          {filteredRecipients.length === 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center text-[13px] text-[#8b92a5]">
              No recipient matched that wallet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
