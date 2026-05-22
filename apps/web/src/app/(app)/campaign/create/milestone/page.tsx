"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { datetimeLocalToUnix } from "@/lib/stream/datetime";
import { validateCreateStreamForm, hasErrors, type FormErrors } from "@/lib/validation/stream-form";
import { getMilestoneCampaignId } from "@/lib/campaign/milestone-ids";
import { useCreateStream, type CreateStreamResult } from "@/hooks/useCreateStream";
import { useWalletTokens } from "@/hooks/useWalletTokens";
import { useToast } from "@/components/shell/Toast";
import { CARD, INPUT, INPUT_ERR, LABEL, SECTION, SectionHeader, Field, ToggleCard, TxResultCard, ErrorCard } from "@/components/campaign/create/shared";
import { FormSummary } from "@/components/campaign/create/FormSummary";
import { PageHeader } from "@/components/campaign/create/PageHeader";
import { TokenPickerButton } from "@/components/campaign/create/TokenPickerButton";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";

type MilestoneEntry = { id: string; unlockTime: string; percentage: string };

type TxState =
  | { type: "idle" }
  | { type: "loading"; label: string }
  | { type: "success"; results: CreateStreamResult[] }
  | { type: "partial"; results: CreateStreamResult[]; total: number; errorMsg: string }
  | { type: "error"; msg: string };

export default function MilestoneCreatePage() {
  const { publicKey } = useWallet();
  const { createStream, formatVestingError } = useCreateStream();
  const { tokens: walletTokens } = useWalletTokens();
  const { toast } = useToast();

  const [beneficiary, setBeneficiary] = useState("");
  const [mintAddress, setMintAddress] = useState("");
  const [mintDecimals, setMintDecimals] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [baseCampaignId] = useState(() => Math.floor(Date.now() / 1000) % 1000000);
  const [startTime, setStartTime] = useState("");
  const [cancellable, setCancellable] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [txState, setTxState] = useState<TxState>({ type: "idle" });

  const [milestones, setMilestones] = useState<MilestoneEntry[]>([
    { id: crypto.randomUUID(), unlockTime: "", percentage: "100" },
  ]);

  // Derived
  const tokenInfo = POPULAR_TOKENS.find((t) => t.mint === mintAddress);
  const tokenSymbol = tokenInfo?.symbol ?? (mintAddress ? mintAddress.slice(0, 4) : "");
  const walletToken = walletTokens.find((t) => t.mintAddress === mintAddress);
  const tokenBalance = walletToken?.uiAmount ?? null;
  const totalPercentage = milestones.reduce((sum, m) => sum + (Number(m.percentage) || 0), 0);
  const streamCount = milestones.length;

  function handleTokenSelect(mint: string, decimals: number) {
    setMintAddress(mint);
    setMintDecimals(decimals);
  }

  function handleMaxAmount() {
    if (walletToken) setAmount(walletToken.uiAmount);
  }

  function addMilestone() {
    setMilestones((prev) => [...prev, { id: crypto.randomUUID(), unlockTime: "", percentage: "" }]);
  }

  function duplicateMilestone(index: number) {
    const source = milestones[index];
    setMilestones((prev) => [
      ...prev.slice(0, index + 1),
      { id: crypto.randomUUID(), unlockTime: "", percentage: source.percentage },
      ...prev.slice(index + 1),
    ]);
  }

  function removeMilestone(index: number) {
    if (milestones.length <= 1) return;
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  }

  function updateMilestone(index: number, field: keyof MilestoneEntry, value: string) {
    setMilestones((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  async function handleSubmit() {
    if (!publicKey) return;

    // Validate percentages
    if (Math.abs(totalPercentage - 100) > 0.01) {
      setFormErrors({ schedule: "Milestone percentages must sum to exactly 100%" });
      return;
    }

    const startUnix = startTime ? datetimeLocalToUnix(startTime) : Number.NaN;

    // Validate first milestone as representative
    const firstUnlock = milestones[0].unlockTime ? datetimeLocalToUnix(milestones[0].unlockTime) : Number.NaN;
    const errors = validateCreateStreamForm({
      beneficiary, mintAddress, amount, mintDecimals,
      campaignId: String(getMilestoneCampaignId(baseCampaignId, 0)),
      startUnix, cliffUnix: firstUnlock, endUnix: firstUnlock, releaseType: 2, milestoneIdx: "0",
    });
    setFormErrors(errors);
    if (hasErrors(errors)) return;

    // Validate all milestones have unlock times + valid percentages
    for (let i = 0; i < milestones.length; i++) {
      if (!milestones[i].unlockTime) {
        setFormErrors({ schedule: `Milestone #${i + 1} is missing an unlock time` });
        return;
      }
      const pct = Number(milestones[i].percentage);
      if (isNaN(pct) || pct <= 0 || pct > 100) {
        setFormErrors({ schedule: `Milestone #${i + 1} percentage must be between 1 and 100` });
        return;
      }
    }

    // Validate chronological order
    const unlockTimes = milestones.map((m) => datetimeLocalToUnix(m.unlockTime));
    for (let i = 1; i < unlockTimes.length; i++) {
      if (unlockTimes[i] <= unlockTimes[i - 1]) {
        setFormErrors({ schedule: `Milestone #${i + 1} unlock time must be after milestone #${i}` });
        return;
      }
    }

    setTxState({ type: "loading", label: `Creating milestone 1 of ${milestones.length}...` });
    const results: CreateStreamResult[] = [];

    try {
      const totalAmount = Math.floor(Number(amount));
      let previousSum = 0;

      for (let i = 0; i < milestones.length; i++) {
        setTxState({ type: "loading", label: `Creating milestone ${i + 1} of ${milestones.length}...` });
        const m = milestones[i];
        const unlockUnix = datetimeLocalToUnix(m.unlockTime);

        let milestoneAmount: string;
        if (i === milestones.length - 1) {
          milestoneAmount = String(totalAmount - previousSum);
        } else {
          const thisAmount = Math.floor(totalAmount * (Number(m.percentage) / 100));
          previousSum += thisAmount;
          milestoneAmount = String(thisAmount);
        }

        const result = await createStream({
          beneficiary, mintAddress, amount: milestoneAmount, mintDecimals,
          campaignId: String(getMilestoneCampaignId(baseCampaignId, i)),
          releaseType: 2, startTime: startUnix, cliffTime: unlockUnix, endTime: unlockUnix,
          milestoneIdx: i, cancellable,
        });
        results.push(result);
      }

      toast(`${results.length} milestone stream(s) created!`, "success");
      setTxState({ type: "success", results });
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast("Transaction rejected by wallet", "error");
        setTxState({ type: "idle" });
        return;
      }
      if (results.length > 0) {
        toast(`${results.length} of ${milestones.length} milestones created. Remaining failed.`, "error");
        setTxState({ type: "partial", results, total: milestones.length, errorMsg: formatVestingError(error) });
        return;
      }
      setTxState({ type: "error", msg: formatVestingError(error) });
    }
  }

  if (!publicKey) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Milestone Vesting" description="Tokens unlock in tranches at specific dates. Each milestone releases its portion." />
        <div className={`${CARD} p-5`}>
          <p className="text-[13px] text-[#8b92a5]">Connect your wallet to create milestone vesting streams.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <PageHeader title="Milestone Vesting" description="Tokens unlock in tranches at specific dates. Each milestone releases its portion." />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Token & Amount Card */}
          <div className={`${CARD} space-y-4 p-5`}>
            <SectionHeader title="Token & Amount" caption="Total amount across all milestones" />
            <div>
              <label className={LABEL}>Token</label>
              <TokenPickerButton mintAddress={mintAddress} onSelect={handleTokenSelect} error={formErrors.mintAddress} />
            </div>
            <Field
              label={`Total Amount${mintDecimals !== null ? ` (${mintDecimals} decimals)` : ""}`}
              input={
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. 1000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={`${INPUT} pr-16 ${formErrors.amount ? INPUT_ERR : ""}`}
                  />
                  <button type="button" onClick={handleMaxAmount} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-white/[0.06] px-2 py-1 text-[10px] font-medium text-[#8b92a5] hover:text-white">
                    Max
                  </button>
                </div>
              }
              error={formErrors.amount}
            />
          </div>

          {/* Recipient Card */}
          <div className={`${CARD} space-y-4 p-5`}>
            <SectionHeader title="Recipient" caption="Wallet that will receive the vested tokens" />
            <Field
              label="Beneficiary Wallet"
              input={
                <input
                  type="text"
                  placeholder="Solana wallet address..."
                  value={beneficiary}
                  onChange={(e) => setBeneficiary(e.target.value)}
                  className={`${INPUT} font-mono ${formErrors.beneficiary ? INPUT_ERR : ""}`}
                />
              }
              error={formErrors.beneficiary}
            />
          </div>

          {/* Start Time */}
          <div className={`${CARD} space-y-4 p-5`}>
            <SectionHeader title="Start Time" caption="When the vesting period begins" />
            <Field
              label="Start Date"
              input={<input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} />}
            />
          </div>

          {/* Milestones Card */}
          <div className={`${CARD} space-y-4 p-5`}>
            <SectionHeader title="Milestones" caption="Define unlock tranches (must sum to 100%)" />

            {milestones.map((m, i) => (
              <div key={m.id} className={`${SECTION} space-y-3`}>
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-white">Milestone #{i + 1}</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => duplicateMilestone(i)} className="rounded-md border border-white/[0.08] px-2 py-1 text-[10px] text-[#8b92a5] hover:text-white">
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMilestone(i)}
                      disabled={milestones.length <= 1}
                      className="rounded-md border border-white/[0.08] px-2 py-1 text-[10px] text-red-400 hover:text-red-300 disabled:opacity-30"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <Field
                  label="Unlock Date"
                  input={<input type="datetime-local" value={m.unlockTime} onChange={(e) => updateMilestone(i, "unlockTime", e.target.value)} className={INPUT} />}
                />
                <Field
                  label="Percentage (%)"
                  input={
                    <input
                      type="number"
                      min="1"
                      max="100"
                      placeholder="e.g. 25"
                      value={m.percentage}
                      onChange={(e) => updateMilestone(i, "percentage", e.target.value)}
                      className={INPUT}
                    />
                  }
                  hint={amount && m.percentage ? `= ${(Number(amount) * Number(m.percentage) / 100).toFixed(2)} ${tokenSymbol}` : undefined}
                />
              </div>
            ))}

            {/* Add button */}
            <button
              type="button"
              onClick={addMilestone}
              disabled={totalPercentage >= 100}
              className="w-full rounded-xl border border-dashed border-white/[0.12] py-3 text-[13px] font-medium text-[#8b92a5] transition hover:border-white/20 hover:text-white disabled:opacity-30"
            >
              + Add new milestone
            </button>

            {/* Percentage summary */}
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2 ${totalPercentage === 100 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
              <span className="text-[12px] font-medium">Total: {totalPercentage}%</span>
              {totalPercentage === 100 && <span className="text-[12px]">✓</span>}
              {totalPercentage !== 100 && <span className="text-[12px]">(must be 100%)</span>}
            </div>

            {formErrors.schedule && <p className="text-[12px] text-red-400">{formErrors.schedule}</p>}
          </div>

          {/* Advanced Settings */}
          <div className={`${CARD} p-5`}>
            <SectionHeader title="Advanced Settings" caption="Optional configuration" />
            <div className="mt-3">
              <ToggleCard checked={cancellable} onChange={setCancellable} title="Allow Cancellation" body="Creator can cancel and reclaim unvested tokens after a 7-day grace period." />
            </div>
          </div>

          {/* Result cards */}
          {txState.type === "success" && (
            <TxResultCard
              title={`${txState.results.length} milestone stream(s) created!`}
              sig={txState.results[0].sig}
              href={txState.results[0].shareUrl}
              linkLabel="Open first stream"
            />
          )}
          {txState.type === "partial" && (
            <div className={`${CARD} p-5 space-y-3`}>
              <p className="text-[13px] font-medium text-amber-400">
                Partial Success: {txState.results.length} of {txState.total} milestones created
              </p>
              <ul className="space-y-1">
                {txState.results.map((r, i) => (
                  <li key={r.sig} className="flex items-center gap-2 text-[11px]">
                    <span className="text-emerald-400">✓</span>
                    <span className="text-[#8b92a5]">Milestone #{i + 1}</span>
                    <a href={r.shareUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-white/70 underline">{r.sig.slice(0, 8)}…</a>
                  </li>
                ))}
                {Array.from({ length: txState.total - txState.results.length }, (_, i) => (
                  <li key={`failed-${i}`} className="flex items-center gap-2 text-[11px]">
                    <span className="text-red-400">✗</span>
                    <span className="text-[#8b92a5]">Milestone #{txState.results.length + i + 1} — failed</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-red-300">{txState.errorMsg}</p>
            </div>
          )}
          {txState.type === "error" && <ErrorCard title="Transaction Failed" body={txState.msg} />}
        </div>

        {/* Sidebar */}
        <FormSummary
          amount={amount}
          tokenSymbol={tokenSymbol}
          tokenBalance={tokenBalance}
          streamCount={streamCount}
          mode="single"
          submitLabel={`Create ${streamCount} Milestone Stream${streamCount > 1 ? "s" : ""}`}
          loading={txState.type === "loading"}
          disabled={!mintAddress || !amount || !beneficiary || totalPercentage !== 100 || milestones.some((m) => !m.unlockTime)}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
