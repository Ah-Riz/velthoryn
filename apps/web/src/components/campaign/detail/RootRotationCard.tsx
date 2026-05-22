"use client";

import { useMemo, useState } from "react";
import { useUpdateRoot } from "@/hooks/useUpdateRoot";
import {
  formatRootRotationPreview,
  parsePreparedRootRotationPayload,
} from "@/lib/campaign/root-rotation";

type RootVersionSummary = {
  version: number;
  merkleRoot: string;
  leafCount: number;
  createdAt: number;
  ipfsCid: string | null;
};

type Props = {
  treeAddress: string;
  canRotate: boolean;
  currentMerkleRoot: string;
  currentLeafCount: number;
  rootVersions: RootVersionSummary[];
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

function truncateHash(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function RootRotationCard({
  treeAddress,
  canRotate,
  currentMerkleRoot,
  currentLeafCount,
  rootVersions,
  onSuccess,
  toast,
}: Props) {
  const { updateRoot, formatVestingError } = useUpdateRoot();
  const [payloadText, setPayloadText] = useState("");
  const [loading, setLoading] = useState(false);
  const parsedPayload = useMemo(
    () => parsePreparedRootRotationPayload(payloadText),
    [payloadText],
  );

  if (!canRotate) return null;

  async function handleRotate() {
    if (!parsedPayload.ok) {
      toast(parsedPayload.error, "error");
      return;
    }

    if (!window.confirm("Warning: Rotating the root will invalidate all existing proofs. Recipients will not be able to claim until new leaf data is indexed. Continue?")) {
      return;
    }

    setLoading(true);
    try {
      const result = await updateRoot({
        treeAddress,
        payload: parsedPayload.payload,
      });

      toast(
        result.version !== null
          ? `Root rotated successfully. Version ${result.version} indexed.`
          : "Root rotated successfully.",
        "success",
      );

      if (result.indexWarning) {
        toast(result.indexWarning, "info");
      }

      setPayloadText("");
      onSuccess();
    } catch (error) {
      if (
        error instanceof Error &&
        /User rejected|Connection rejected/i.test(error.message)
      ) {
        return;
      }
      toast(formatVestingError(error), "error");
    } finally {
      setLoading(false);
    }
  }

  const latestVersion = rootVersions[0]?.version ?? 0;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="space-y-1">
        <h3 className="text-[15px] font-medium text-white">Root Rotation</h3>
        <p className="text-[13px] leading-6 text-[#8b92a5]">
          Paste a prepared Merkle payload from the off-chain builder. This updates the on-chain root and
          syncs the indexed leaves. Do not use a free-form root hex as the primary workflow.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-[#11161f] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f7c95]">Current Root</p>
          <p className="mt-2 font-mono text-[12px] text-white">{truncateHash(currentMerkleRoot)}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#11161f] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f7c95]">Current Version</p>
          <p className="mt-2 text-[13px] text-white">v{latestVersion || 1} · {currentLeafCount} leaves</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-200">
        Rotating the root changes future claim eligibility. If the payload is not synced with the indexer/API,
        later proof lookups can fail even when the on-chain transaction succeeds.
      </div>

      <label className="mt-4 block space-y-2">
        <span className="text-[12px] font-medium text-[#8b92a5]">Prepared Root Payload (JSON)</span>
        <textarea
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          rows={10}
          placeholder='{"merkleRoot":"...","leafCount":2,"leaves":[...],"ipfsCid":"..."}'
          className="w-full rounded-xl border border-white/[0.08] bg-[#11161f] px-4 py-3 font-mono text-[12px] text-white outline-none transition focus:border-white/20"
        />
      </label>

      {payloadText.trim() && !parsedPayload.ok && (
        <p className="mt-3 text-[12px] text-red-400">{parsedPayload.error}</p>
      )}

      {parsedPayload.ok && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {formatRootRotationPreview(parsedPayload.payload).map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-white/[0.06] bg-[#11161f] px-4 py-3"
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f7c95]">{item.label}</p>
              <p className="mt-2 break-all font-mono text-[12px] text-white">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[12px] leading-6 text-[#8b92a5]">
          Only the on-chain <span className="font-medium text-white">cancel authority</span> can rotate the root.
        </p>
        <button
          onClick={handleRotate}
          disabled={loading || !parsedPayload.ok}
          className="rounded-xl border border-white/[0.08] bg-white px-4 py-2.5 text-[13px] font-medium text-[#0d1117] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Rotating..." : "Rotate Root"}
        </button>
      </div>
    </div>
  );
}
