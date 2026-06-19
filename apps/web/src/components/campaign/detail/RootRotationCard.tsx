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

function StepPill({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-muted px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{step}</p>
      <p className="mt-2 text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[12px] leading-6 text-muted-foreground">{body}</p>
    </div>
  );
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
  const nextVersion = (latestVersion || 1) + 1;

  return (
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-medium text-foreground">Update Allocations</h3>
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
            Advanced
          </span>
        </div>
        <p className="text-[13px] leading-6 text-muted-foreground">
          Publish a new recipient payload for future claims.
        </p>
        <p className="text-[12px] leading-6 text-muted-foreground">
          Technical name: <span className="font-medium text-foreground">Root Rotation</span>.
        </p>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-foreground/[0.06] bg-muted px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Current Root</p>
          <p className="mt-2 font-mono text-[12px] text-foreground">{truncateHash(currentMerkleRoot)}</p>
        </div>
        <div className="rounded-xl border border-foreground/[0.06] bg-muted px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Current Version</p>
          <p className="mt-2 text-[13px] text-foreground">v{latestVersion || 1} · {currentLeafCount} leaves</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-700/80 dark:text-emerald-300/80">After Update</p>
          <p className="mt-2 text-[13px] text-foreground">Next indexed version: v{nextVersion}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <StepPill
          step="What Changes"
          title="Future claim eligibility"
          body="The new payload becomes the source of truth."
        />
        <StepPill
          step="What Stays"
          title="Already claimed tokens"
          body="Already claimed tokens stay claimed."
        />
        <StepPill
          step="Main Risk"
          title="Old proofs stop working"
          body="Recipients must refresh to the new proof data."
        />
      </div>

      <label className="mt-4 block space-y-2">
        <span className="text-[12px] font-medium text-muted-foreground">Prepared Builder Payload (JSON)</span>
        <textarea
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          rows={10}
          placeholder='{"merkleRoot":"...","leafCount":2,"leaves":[...],"ipfsCid":"..."}'
          className="w-full rounded-xl border border-foreground/[0.08] bg-muted px-4 py-3 font-mono text-[12px] text-foreground outline-none transition focus:border-foreground/20"
        />
      </label>
      <p className="mt-2 text-[11px] leading-6 text-muted-foreground">
        Paste the full builder payload, not just a root hash.
      </p>

      {payloadText.trim() && !parsedPayload.ok && (
        <p className="mt-3 text-[12px] text-red-700 dark:text-red-400">{parsedPayload.error}</p>
      )}

      {parsedPayload.ok && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-700/80 dark:text-emerald-300/80">Ready To Publish</p>
            <p className="mt-2 text-[12px] leading-6 text-emerald-100">
              Payload looks valid. Review before publishing.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
          {formatRootRotationPreview(parsedPayload.payload).map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-foreground/[0.06] bg-muted px-4 py-3"
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
              <p className="mt-2 break-all font-mono text-[12px] text-foreground">{item.value}</p>
            </div>
          ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-[12px] leading-6 text-muted-foreground">
            Only the on-chain <span className="font-medium text-foreground">cancel authority</span> can publish this.
          </p>
          <p className="text-[11px] leading-6 text-muted-foreground">
            Publish only after the new payload is ready and indexed.
          </p>
        </div>
        <button
          onClick={handleRotate}
          disabled={loading || !parsedPayload.ok}
          className="rounded-xl border border-foreground/[0.08] bg-foreground px-4 py-2.5 text-[13px] font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Publishing..." : "Publish Allocation Update"}
        </button>
      </div>
    </div>
  );
}
