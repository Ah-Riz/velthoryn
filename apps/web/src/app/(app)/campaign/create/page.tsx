"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { BN } from "@coral-xyz/anchor";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";
import { datetimeLocalToUnix } from "@/lib/stream/datetime";
import {
  buildCreateStreamIndexPayload,
  indexStreamCampaign,
  saveStreamScheduleLocal,
} from "@/lib/stream/persist";
import {
  validateCreateStreamForm,
  hasErrors,
  type FormErrors,
} from "@/lib/validation/stream-form";
import { useToast } from "@/components/shell/Toast";

/* ---------- constants ---------- */

const RELEASE_TYPES = [
  { value: 0, label: "Cliff", desc: "Full unlock at cliff time" },
  { value: 1, label: "Linear", desc: "Gradual unlock from cliff to end" },
  { value: 2, label: "Milestone", desc: "Full unlock at milestone index" },
] as const;

function toUnixTs(dateStr: string): number {
  return datetimeLocalToUnix(dateStr);
}

/* ---------- shared classnames ---------- */

const CARD =
  "rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 space-y-4";
const INPUT_BASE =
  "w-full rounded-xl bg-[#11141c] border px-4 py-2.5 text-[13px] text-white placeholder-[#4a4f5e] outline-none transition focus:border-violet-500/60";
const INPUT_OK = "border-white/[0.08]";
const INPUT_ERR = "border-red-500/40";
const LABEL = "block text-[12px] font-medium text-[#8b92a5] mb-1.5";
const SECTION_HEADING = "text-[15px] font-medium text-white";

/* ---------- component ---------- */

export default function CreateStreamPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useVestingProgram();
  const { toast } = useToast();

  /* form state */
  const [beneficiary, setBeneficiary] = useState("");
  const [mintAddress, setMintAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [mintDecimals, setMintDecimals] = useState<number | null>(null);
  const [mintSymbol, setMintSymbol] = useState<string | null>(null);
  const [mintLoading, setMintLoading] = useState(false);
  const [releaseType, setReleaseType] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [cliffTime, setCliffTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [campaignId, setCampaignId] = useState(() =>
    String(Math.floor(Date.now() / 1000) % 1000000),
  );
  const [cancellable, setCancellable] = useState(false);
  const [milestoneIdx, setMilestoneIdx] = useState("0");

  /* tx state */
  const [txStatus, setTxStatus] = useState<
    | { type: "idle" }
    | { type: "loading" }
    | { type: "success"; sig: string; treeAddress: string }
    | { type: "error"; msg: string }
  >({ type: "idle" });

  const [formErrors, setFormErrors] = useState<FormErrors>({});

  /* ---------- fetch mint decimals ---------- */

  const fetchMintInfo = useCallback(async (addr: string) => {
    setMintDecimals(null);
    setMintSymbol(null);
    try {
      const pubkey = new PublicKey(addr);
      setMintLoading(true);
      const info = await connection.getParsedAccountInfo(pubkey);
      const parsed = (info.value?.data as any)?.parsed;
      if (parsed?.type === "mint") {
        setMintDecimals(parsed.info.decimals);
      }
    } catch {
      setMintDecimals(null);
    } finally {
      setMintLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    if (mintAddress.length >= 32 && mintAddress.length <= 44) {
      try {
        new PublicKey(mintAddress);
        fetchMintInfo(mintAddress);
      } catch {
        setMintDecimals(null);
      }
    } else {
      setMintDecimals(null);
    }
  }, [mintAddress, fetchMintInfo]);

  function toRawAmount(humanAmount: string, decimals: number): string {
    const parts = humanAmount.split(".");
    const whole = parts[0] || "0";
    const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
    const raw = whole + frac;
    return raw.replace(/^0+/, "") || "0";
  }

  /* ---------- submit handler ---------- */

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!program || !publicKey) return;

    const startUnix = startTime ? toUnixTs(startTime) : NaN;
    const cliffUnix = cliffTime ? toUnixTs(cliffTime) : NaN;
    const endUnix = endTime ? toUnixTs(endTime) : NaN;

    const errors = validateCreateStreamForm({
      beneficiary,
      mintAddress,
      amount,
      campaignId,
      startUnix,
      cliffUnix,
      endUnix,
      releaseType,
      milestoneIdx,
    });

    setFormErrors(errors);
    if (hasErrors(errors)) return;

    setTxStatus({ type: "loading" });

    try {
      const beneficiaryKey = new PublicKey(beneficiary);
      const mintKey = new PublicKey(mintAddress);
      const rawAmount = mintDecimals !== null ? toRawAmount(amount, mintDecimals) : amount;
      const amountBN = new BN(rawAmount);
      const campaignIdBN = new BN(campaignId);
      const startUnix = toUnixTs(startTime);
      const cliffUnix = toUnixTs(cliffTime);
      const endUnix = toUnixTs(endTime);
      const startTs = new BN(startUnix);
      const cliffTs = new BN(cliffUnix);
      const endTs = new BN(endUnix);

      const [vestingTree] = derivePda([
        "tree",
        publicKey.toBuffer(),
        mintKey.toBuffer(),
        campaignIdBN.toArrayLike(Buffer, "le", 8),
      ]);
      const [vaultAuthority] = derivePda(["vault_authority", vestingTree.toBuffer()]);

      const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } =
        await import("@solana/spl-token");
      const { SystemProgram, SYSVAR_RENT_PUBKEY } = await import("@solana/web3.js");
      const sourceAta = getAssociatedTokenAddressSync(mintKey, publicKey);
      const vault = getAssociatedTokenAddressSync(mintKey, vaultAuthority, true);

      const accountsObj = {
        creator: publicKey,
        vestingTree,
        vaultAuthority,
        vault,
        sourceAta,
        mint: mintKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      };

      const argsObj = {
        campaignId: campaignIdBN,
        beneficiary: beneficiaryKey,
        amount: amountBN,
        releaseType,
        startTime: startTs,
        cliffTime: cliffTs,
        endTime: endTs,
        milestoneIdx: Number(milestoneIdx),
        cancellable,
        cancelAuthority: cancellable ? publicKey : null,
        pauseAuthority: publicKey,
      };

      const sig = await program.methods
        .createStream(argsObj)
        .accounts(accountsObj)
        .rpc();

      const treeAddress = vestingTree.toBase58();
      const schedule = {
        releaseType,
        startTime: startUnix,
        cliffTime: cliffUnix,
        endTime: endUnix,
        milestoneIdx: Number(milestoneIdx),
      };
      saveStreamScheduleLocal(treeAddress, schedule);

      try {
        const payload = buildCreateStreamIndexPayload({
          treeAddress,
          creator: publicKey.toBase58(),
          mint: mintKey.toBase58(),
          campaignId: Number(campaignId),
          beneficiary: beneficiaryKey.toBase58(),
          amount: rawAmount,
          releaseType,
          startTime: startUnix,
          cliffTime: cliffUnix,
          endTime: endUnix,
          milestoneIdx: Number(milestoneIdx),
          cancellable,
          cancelAuthority: cancellable ? publicKey.toBase58() : null,
        });
        await indexStreamCampaign(payload);
      } catch {
        /* Campaign index POST failed -- stream is still on-chain */
      }

      const params = new URLSearchParams({
        rt: String(releaseType),
        st: String(startUnix),
        ct: String(cliffUnix),
        et: String(endUnix),
        mi: String(milestoneIdx),
      });
      const shareLink = `/campaign/${treeAddress}?${params}`;

      toast("Stream created successfully!", "success");
      setTxStatus({ type: "success", sig, treeAddress: shareLink });
    } catch (err: unknown) {
      /* wallet rejection -- silently reset */
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      ) {
        toast("Transaction was rejected by wallet", "error");
        setTxStatus({ type: "idle" });
        return;
      }
      setTxStatus({ type: "error", msg: formatVestingError(err) });
    }
  }

  /* ---------- render ---------- */

  if (!publicKey) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-[22px] font-semibold text-white">Create Vesting Stream</h1>
          <p className="mt-1 text-[13px] text-[#8b92a5]">
            Set up a new token vesting stream for a single recipient.
          </p>
        </div>
        <div className={CARD}>
          <p className="text-[13px] text-[#8b92a5]">
            Connect your wallet to create a vesting stream.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* page heading */}
      <div>
        <h1 className="text-[22px] font-semibold text-white">Create Vesting Stream</h1>
        <p className="mt-1 text-[13px] text-[#8b92a5]">
          Set up a new token vesting stream for a single recipient.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* --- section 1: Campaign Configuration --- */}
        <div className={CARD}>
          <h2 className={SECTION_HEADING}>Campaign Configuration</h2>
          <div>
            <label className={LABEL}>Campaign ID</label>
            <input
              type="number"
              min="1"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className={`${INPUT_BASE} ${formErrors.campaignId ? INPUT_ERR : INPUT_OK}`}
              required
            />
            {formErrors.campaignId && (
              <p className="mt-1 text-[11px] text-red-400">{formErrors.campaignId}</p>
            )}
          </div>
        </div>

        {/* --- section 2: Token Details --- */}
        <div className={CARD}>
          <h2 className={SECTION_HEADING}>Token Details</h2>
          <div>
            <label className={LABEL}>Mint Address</label>
            <input
              type="text"
              placeholder="Token mint public key"
              value={mintAddress}
              onChange={(e) => setMintAddress(e.target.value)}
              className={`${INPUT_BASE} font-mono ${formErrors.mintAddress ? INPUT_ERR : INPUT_OK}`}
              required
            />
            {mintLoading && (
              <p className="mt-1 text-[11px] text-[#555d73]">Fetching mint info...</p>
            )}
            {mintDecimals !== null && !mintLoading && (
              <p className="mt-1 text-[11px] text-emerald-400">
                Mint detected — {mintDecimals} decimals
              </p>
            )}
            {formErrors.mintAddress && (
              <p className="mt-1 text-[11px] text-red-400">{formErrors.mintAddress}</p>
            )}
          </div>
          <div>
            <label className={LABEL}>
              Amount{mintDecimals !== null ? ` (${mintDecimals} decimals detected)` : ""}
            </label>
            <input
              type="text"
              placeholder={mintDecimals !== null ? "e.g. 1000" : "e.g. 1000000000 (raw)"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${INPUT_BASE} ${formErrors.amount ? INPUT_ERR : INPUT_OK}`}
              required
            />
            {mintDecimals !== null && amount && (
              <p className="mt-1 text-[11px] text-[#555d73]">
                = {toRawAmount(amount, mintDecimals)} raw tokens
              </p>
            )}
            {formErrors.amount && (
              <p className="mt-1 text-[11px] text-red-400">{formErrors.amount}</p>
            )}
          </div>
        </div>

        {/* --- section 3: Recipient --- */}
        <div className={CARD}>
          <h2 className={SECTION_HEADING}>Recipient</h2>
          <div>
            <label className={LABEL}>Beneficiary Wallet</label>
            <input
              type="text"
              placeholder="Recipient wallet address"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              className={`${INPUT_BASE} font-mono ${formErrors.beneficiary ? INPUT_ERR : INPUT_OK}`}
              required
            />
            {formErrors.beneficiary && (
              <p className="mt-1 text-[11px] text-red-400">{formErrors.beneficiary}</p>
            )}
          </div>
        </div>

        {/* --- section 4: Release Schedule --- */}
        <div className={CARD}>
          <h2 className={SECTION_HEADING}>Release Schedule</h2>

          {/* release type selector */}
          <div>
            <label className={LABEL}>Release Type</label>
            <div className="grid grid-cols-3 gap-3">
              {RELEASE_TYPES.map((rt) => (
                <button
                  key={rt.value}
                  type="button"
                  onClick={() => setReleaseType(rt.value)}
                  className={`relative rounded-2xl border p-3.5 text-left transition-all ${
                    releaseType === rt.value
                      ? "border-violet-500/40 bg-violet-500/[0.06]"
                      : "border-white/[0.06] bg-white/[0.01] hover:border-white/[0.12]"
                  }`}
                >
                  {/* radio indicator */}
                  <div
                    className={`mb-2 h-4 w-4 rounded-full border-2 transition-colors ${
                      releaseType === rt.value
                        ? "border-violet-500 bg-violet-500"
                        : "border-white/20 bg-transparent"
                    }`}
                  >
                    {releaseType === rt.value && (
                      <div className="flex h-full w-full items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                  <div className="text-[13px] font-medium text-white">{rt.label}</div>
                  <div className="mt-0.5 text-[11px] text-[#8b92a5]">{rt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* time fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL}>Start Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`${INPUT_BASE} ${INPUT_OK}`}
                required
              />
            </div>
            <div>
              <label className={LABEL}>Cliff Time</label>
              <input
                type="datetime-local"
                value={cliffTime}
                onChange={(e) => setCliffTime(e.target.value)}
                className={`${INPUT_BASE} ${INPUT_OK}`}
                required
              />
            </div>
            <div>
              <label className={LABEL}>End Time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`${INPUT_BASE} ${INPUT_OK}`}
                required
              />
            </div>
          </div>
          {formErrors.schedule && (
            <p className="text-[11px] text-red-400">{formErrors.schedule}</p>
          )}

          {/* conditional milestone index */}
          {releaseType === 2 && (
            <div>
              <label className={LABEL}>Milestone Index</label>
              <input
                type="number"
                min="0"
                max="255"
                value={milestoneIdx}
                onChange={(e) => setMilestoneIdx(e.target.value)}
                className={`${INPUT_BASE} ${formErrors.milestoneIdx ? INPUT_ERR : INPUT_OK}`}
              />
              {formErrors.milestoneIdx && (
                <p className="mt-1 text-[11px] text-red-400">{formErrors.milestoneIdx}</p>
              )}
            </div>
          )}
        </div>

        {/* --- section 5: Options --- */}
        <div className={CARD}>
          <h2 className={SECTION_HEADING}>Options</h2>
          <label
            htmlFor="cancellable"
            className="flex cursor-pointer items-center gap-3"
          >
            <div className="relative">
              <input
                type="checkbox"
                id="cancellable"
                checked={cancellable}
                onChange={(e) => setCancellable(e.target.checked)}
                className="peer sr-only"
              />
              <div className="h-5 w-9 rounded-full border border-white/[0.08] bg-[#11141c] transition-colors peer-checked:border-violet-500/40 peer-checked:bg-violet-600" />
              <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[#4a4f5e] transition-all peer-checked:left-[18px] peer-checked:bg-white" />
            </div>
            <div>
              <span className="text-[13px] text-white">Cancellable</span>
              <p className="text-[11px] text-[#8b92a5]">
                Creator can cancel and reclaim unvested tokens
              </p>
            </div>
          </label>
        </div>

        {/* --- submit button --- */}
        <button
          type="submit"
          disabled={txStatus.type === "loading"}
          className="w-full rounded-xl bg-violet-600 py-3 text-[14px] font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {txStatus.type === "loading" ? (
            <span className="inline-flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Creating Stream...
            </span>
          ) : (
            "Create Stream"
          )}
        </button>

        {/* --- success: link to stream --- */}
        {txStatus.type === "success" && (
          <div className={`${CARD} !border-emerald-500/20`}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-emerald-400"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="min-w-0 space-y-1.5">
                <p className="text-[13px] font-medium text-emerald-400">
                  Stream created successfully!
                </p>
                <p className="break-all font-mono text-[11px] text-[#8b92a5]">
                  Signature: {txStatus.sig}
                </p>
                <Link
                  href={txStatus.treeAddress}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-violet-400 transition hover:text-violet-300"
                >
                  Open stream
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* --- error: inline card for tx errors --- */}
        {txStatus.type === "error" && (
          <div className={`${CARD} !border-red-500/20`}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-red-400"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[13px] font-medium text-red-400">
                  Transaction Failed
                </p>
                <p className="text-[11px] text-[#8b92a5]">{txStatus.msg}</p>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
