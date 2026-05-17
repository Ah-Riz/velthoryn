"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);
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

const RELEASE_TYPES = [
  { value: 0, label: "Cliff", desc: "Full unlock at cliff time" },
  { value: 1, label: "Linear", desc: "Gradual unlock from cliff to end" },
  { value: 2, label: "Milestone", desc: "Full unlock at milestone time" },
] as const;

function toUnixTs(dateStr: string): number {
  return datetimeLocalToUnix(dateStr);
}

export default function CreateStreamPage() {
  const { publicKey } = useWallet();
  const program = useVestingProgram();

  const [beneficiary, setBeneficiary] = useState("");
  const [mintAddress, setMintAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [releaseType, setReleaseType] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [cliffTime, setCliffTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [campaignId, setCampaignId] = useState("1");
  const [cancellable, setCancellable] = useState(false);
  const [milestoneIdx, setMilestoneIdx] = useState("0");

  const [txStatus, setTxStatus] = useState<
    | { type: "idle" }
    | { type: "loading" }
    | { type: "success"; sig: string; treeAddress: string }
    | { type: "error"; msg: string }
  >({ type: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!program || !publicKey) return;

    setTxStatus({ type: "loading" });

    try {
      const beneficiaryKey = new PublicKey(beneficiary);
      const mintKey = new PublicKey(mintAddress);
      const amountBN = new BN(amount);
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

      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const sourceAta = getAssociatedTokenAddressSync(mintKey, publicKey);
      const vault = getAssociatedTokenAddressSync(mintKey, vaultAuthority, true);

      const sig = await program.methods
        .createStream({
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
          pauseAuthority: null,
        })
        .accounts({
          creator: publicKey,
          vestingTree,
          vaultAuthority,
          vault,
          sourceAta,
          mint: mintKey,
        })
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
          amount,
          releaseType,
          startTime: startUnix,
          cliffTime: cliffUnix,
          endTime: endUnix,
          milestoneIdx: Number(milestoneIdx),
          cancellable,
          cancelAuthority: cancellable ? publicKey.toBase58() : null,
        });
        await indexStreamCampaign(payload);
      } catch (indexErr) {
        console.warn("Campaign index POST failed (stream still on-chain):", indexErr);
      }

      setTxStatus({ type: "success", sig, treeAddress });
    } catch (err: unknown) {
      setTxStatus({ type: "error", msg: formatVestingError(err) });
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Create Vesting Stream</h1>
        <WalletMultiButton />
      </div>

      {!publicKey ? (
        <p className="text-gray-400">Connect wallet to create a vesting stream.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Campaign ID</label>
            <input
              type="number"
              min="1"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 focus:border-purple-500 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Token Mint Address</label>
            <input
              type="text"
              placeholder="Token mint public key"
              value={mintAddress}
              onChange={(e) => setMintAddress(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 focus:border-purple-500 outline-none font-mono text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Beneficiary Wallet</label>
            <input
              type="text"
              placeholder="Recipient wallet address"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 focus:border-purple-500 outline-none font-mono text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (raw tokens, no decimals)</label>
            <input
              type="text"
              placeholder="e.g. 1000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 focus:border-purple-500 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Release Type</label>
            <div className="grid grid-cols-3 gap-3">
              {RELEASE_TYPES.map((rt) => (
                <button
                  key={rt.value}
                  type="button"
                  onClick={() => setReleaseType(rt.value)}
                  className={`p-3 rounded-lg border text-left transition ${releaseType === rt.value
                      ? "border-purple-500 bg-purple-500/10"
                      : "border-gray-700 hover:border-gray-500"
                    }`}
                >
                  <div className="font-medium">{rt.label}</div>
                  <div className="text-xs text-gray-400 mt-1">{rt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Start Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 focus:border-purple-500 outline-none text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Cliff Time</label>
              <input
                type="datetime-local"
                value={cliffTime}
                onChange={(e) => setCliffTime(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 focus:border-purple-500 outline-none text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">End Time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 focus:border-purple-500 outline-none text-sm"
                required
              />
            </div>
          </div>

          {releaseType === 2 && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Milestone Index</label>
              <input
                type="number"
                min="0"
                max="255"
                value={milestoneIdx}
                onChange={(e) => setMilestoneIdx(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 focus:border-purple-500 outline-none"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="cancellable"
              checked={cancellable}
              onChange={(e) => setCancellable(e.target.checked)}
              className="w-4 h-4 accent-purple-500"
            />
            <label htmlFor="cancellable" className="text-sm text-gray-400">
              Cancellable (creator can cancel unvested tokens)
            </label>
          </div>

          <button
            type="submit"
            disabled={txStatus.type === "loading"}
            className="w-full py-3 bg-purple-600 rounded-lg font-medium hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {txStatus.type === "loading" ? "Creating Stream..." : "Create Stream"}
          </button>

          {txStatus.type === "success" && (
            <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg space-y-2">
              <p className="text-green-400 font-medium">Stream created!</p>
              <p className="text-xs text-gray-400 font-mono break-all">
                tx: {txStatus.sig}
              </p>
              <Link
                href={`/campaign/${txStatus.treeAddress}`}
                className="inline-block text-sm text-purple-400 hover:text-purple-300 underline"
              >
                Open stream → claim tokens
              </Link>
            </div>
          )}

          {txStatus.type === "error" && (
            <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
              <p className="text-red-400 font-medium">Error</p>
              <p className="text-xs text-gray-400 mt-1">{txStatus.msg}</p>
            </div>
          )}
        </form>
      )}
    </main>
  );
}
