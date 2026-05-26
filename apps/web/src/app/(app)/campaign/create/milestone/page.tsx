"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { datetimeLocalToUnix } from "@/lib/stream/datetime";
import { validatePublicKey, validateAmountWithDecimals, hasErrors } from "@/lib/validation/stream-form";
import { bulkCsvTemplateForType, parseBulkCsv, prepareBulkCampaign, toRawAmount, type BulkCsvParseResult, type BulkCsvRow, type PreparedBulkCampaign } from "@/lib/campaign/bulk";
import { useCreateCampaign } from "@/hooks/useCreateCampaign";
import { useCreateStream, type CreateStreamResult } from "@/hooks/useCreateStream";
import { useWalletTokens } from "@/hooks/useWalletTokens";
import { useToast } from "@/components/shell/Toast";
import { CARD, INPUT, INPUT_ERR, LABEL, SectionHeader, Field, ToggleCard, TxResultCard, ErrorCard } from "@/components/campaign/create/shared";
import { BulkCsvSection } from "@/components/campaign/create/BulkCsvSection";
import { FormSummary } from "@/components/campaign/create/FormSummary";
import { PageHeader } from "@/components/campaign/create/PageHeader";
import { TokenPickerButton } from "@/components/campaign/create/TokenPickerButton";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";

type MilestoneEntry = {
  id: string;
  amount: string;
  unlockTime: string;
};

type TxState =
  | { type: "idle" }
  | { type: "loading"; label: string }
  | { type: "success"; results: CreateStreamResult[] }
  | { type: "error"; msg: string }
  | { type: "bulk-ready"; prepared: PreparedBulkCampaign }
  | { type: "bulk-funded"; sig: string; treeAddress: string; prepared: PreparedBulkCampaign };

type Mode = "single" | "bulk";

function newMilestone(): MilestoneEntry {
  return { id: crypto.randomUUID(), amount: "", unlockTime: "" };
}

function toWalletApprovalMessage(error: unknown, fallback: (err: unknown) => string) {
  const formatted = fallback(error);
  return formatted === "Transaction cancelled in wallet."
    ? "Wallet approval did not complete."
    : formatted;
}

export default function MilestoneCreatePage() {
  const { publicKey } = useWallet();
  const { createStream, formatVestingError } = useCreateStream();
  const { createAndFundCampaign, formatVestingError: formatCampaignError } = useCreateCampaign();
  const { tokens: walletTokens } = useWalletTokens();
  const { toast } = useToast();

  // General
  const [mode, setMode] = useState<Mode>("single");
  const [mintAddress, setMintAddress] = useState("");
  const [mintDecimals, setMintDecimals] = useState<number | null>(null);
  const [useAutoWrap, setUseAutoWrap] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [baseCampaignId] = useState(() => Math.floor(Date.now() / 1000) % 1000000);

  // Milestone entries
  const [milestones, setMilestones] = useState<MilestoneEntry[]>([newMilestone()]);
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({});
  const [txState, setTxState] = useState<TxState>({ type: "idle" });

  // Bulk state
  const [csvText, setCsvText] = useState("");
  const [csvResult, setCsvResult] = useState<BulkCsvParseResult | null>(null);
  const [bulkCampaignId] = useState(() => String(Math.floor(Date.now() / 1000) % 1000000));

  // Derived
  const tokenInfo = POPULAR_TOKENS.find((t) => t.mint === mintAddress);
  const effectiveMintDecimals = tokenInfo?.decimals ?? mintDecimals;
  const tokenSymbol = tokenInfo?.symbol ?? (mintAddress ? mintAddress.slice(0, 4) : "");
  const walletToken = tokenInfo?.isNativeSol
    ? walletTokens.find((t) => t.isNativeSol)
    : tokenInfo?.isWrappedSol
    ? walletTokens.find((t) => t.mintAddress === mintAddress && !t.isNativeSol)
    : walletTokens.find((t) => t.mintAddress === mintAddress && !t.isNativeSol) ?? walletTokens.find((t) => t.mintAddress === mintAddress);
  const tokenBalance = walletToken?.uiAmount ?? null;
  const totalAmount = milestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const manualCreatesCampaign = milestones.length > 1;

  // Bulk handlers
  function handleCsvParse() {
    if (!csvText.trim()) return;
    const result = parseBulkCsv(csvText, effectiveMintDecimals);
    setCsvResult(result);
    if (result.issues.length === 0 && result.rows.length > 0) {
      setTxState({ type: "bulk-ready", prepared: prepareBulkCampaign(result.rows) });
    } else {
      setTxState({ type: "idle" });
    }
  }

  async function handleBulkCreate() {
    if (txState.type !== "bulk-ready") return;
    setTxState({ type: "loading", label: "Creating and funding campaign..." });
    try {
      const result = await createAndFundCampaign(
        { mintAddress, campaignId: bulkCampaignId, prepared: txState.prepared, cancellable },
        { autoWrap: useAutoWrap },
      );
      toast("Campaign created and funded!", "success");
      setTxState({ type: "bulk-funded", sig: result.fundSig, treeAddress: result.treeAddress, prepared: txState.prepared });
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast(toWalletApprovalMessage(error, formatCampaignError), "error");
        setTxState({ type: "bulk-ready", prepared: txState.prepared });
        return;
      }
      setTxState({ type: "error", msg: formatCampaignError(error) });
    }
  }
  const prepared = txState.type === "bulk-ready" || txState.type === "bulk-funded" ? txState.prepared : null;

  function handleTokenSelect(mint: string, decimals: number, autoWrap?: boolean) {
    setMintAddress(mint);
    setMintDecimals(decimals);
    setUseAutoWrap(autoWrap ?? false);
    if (mode === "bulk" && csvText.trim()) {
      const result = parseBulkCsv(csvText, decimals);
      setCsvResult(result);
      if (result.issues.length === 0 && result.rows.length > 0) {
        setTxState({ type: "bulk-ready", prepared: prepareBulkCampaign(result.rows) });
      } else {
        setTxState({ type: "idle" });
      }
    }
  }

  function updateMilestone(id: string, field: keyof MilestoneEntry, value: string) {
    setMilestones((prev) => prev.map((m) => m.id === id ? { ...m, [field]: value } : m));
  }

  function duplicateMilestone(index: number) {
    const source = milestones[index];
    setMilestones((prev) => [...prev.slice(0, index + 1), { ...source, id: crypto.randomUUID() }, ...prev.slice(index + 1)]);
  }

  function removeMilestone(index: number) {
    if (milestones.length <= 1) return;
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  }

  function buildMilestoneRows(): BulkCsvRow[] {
    const now = Math.floor(Date.now() / 1000);
    return milestones.map((m, index) => {
      const unlockUnix = m.unlockTime ? datetimeLocalToUnix(m.unlockTime) : now + 60;
      return {
        rowNumber: index + 1,
        beneficiary: recipient.trim(),
        amountInput: m.amount.trim(),
        amountRaw: effectiveMintDecimals !== null ? toRawAmount(m.amount.trim(), effectiveMintDecimals) : m.amount.trim(),
        releaseType: 2,
        startTime: now - 60,
        cliffTime: unlockUnix,
        endTime: unlockUnix,
        milestoneIdx: index,
      };
    });
  }

  async function handleSubmit() {
    if (!publicKey || !mintAddress) return;

    // Validate
    const errors: Record<string, string | null> = {};
    const recipErr = validatePublicKey(recipient);
    if (recipErr) errors.recipient = recipErr;
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      const amtErr = validateAmountWithDecimals(m.amount, effectiveMintDecimals);
      if (amtErr) errors[`amount_${i}`] = amtErr;
    }
    setFormErrors(errors);
    if (hasErrors(errors)) return;

    // 2+ milestones → single campaign with N leaves
    if (milestones.length > 1) {
      setTxState({ type: "loading", label: `Creating campaign with ${milestones.length} milestones...` });
      try {
        const prepared = prepareBulkCampaign(buildMilestoneRows());
        const result = await createAndFundCampaign(
          { mintAddress, campaignId: String(baseCampaignId), prepared, cancellable },
          { autoWrap: useAutoWrap },
        );
        toast("Milestone campaign created and funded!", "success");
        setTxState({ type: "bulk-funded", sig: result.fundSig, treeAddress: result.treeAddress, prepared });
        setMilestones([newMilestone()]);
        setFormErrors({});
      } catch (error: unknown) {
        if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
          toast("Transaction rejected", "error");
          setTxState({ type: "idle" });
          return;
        }
        setTxState({ type: "error", msg: formatCampaignError(error) });
      }
      return;
    }

    // 1 milestone → single stream
    setTxState({ type: "loading", label: "Creating milestone stream..." });
    try {
      const now = Math.floor(Date.now() / 1000);
      const m = milestones[0];
      const unlockUnix = m.unlockTime ? datetimeLocalToUnix(m.unlockTime) : now + 60;

      const result = await createStream({
        beneficiary: recipient,
        mintAddress,
        amount: m.amount,
        mintDecimals: effectiveMintDecimals,
        campaignId: String(baseCampaignId),
        releaseType: 2,
        startTime: now - 60,
        cliffTime: unlockUnix,
        endTime: unlockUnix,
        milestoneIdx: 0,
        cancellable,
        autoWrap: useAutoWrap,
      });

      toast("Milestone stream created!", "success");
      setTxState({ type: "success", results: [result] });
      setMilestones([newMilestone()]);
      setFormErrors({});
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast("Transaction rejected", "error");
        setTxState({ type: "idle" });
        return;
      }
      setTxState({ type: "error", msg: formatVestingError(error) });
    }
  }

  if (!publicKey) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Milestone Vesting" description="Tokens unlock when the creator triggers each milestone. Not time-based." />
        <div className={`${CARD} p-5`}>
          <p className="text-[13px] text-[#8b92a5]">Connect your wallet to create milestone vesting streams.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <PageHeader title="Milestone Vesting" description="Tokens unlock when the creator triggers each milestone. Not time-based." />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* General Details Card */}
          <div className={`${CARD} space-y-4 p-5`}>
            <SectionHeader title="General Details" caption="Token and campaign settings" />

            {/* Mode Toggle */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setMode("single"); setTxState({ type: "idle" }); }}
                className={`flex-1 rounded-lg px-3 py-2.5 text-[12px] font-medium transition ${mode === "single" ? "bg-white/[0.1] text-white" : "text-[#8b92a5] hover:text-white"}`}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => { setMode("bulk"); setTxState({ type: "idle" }); }}
                className={`flex-1 rounded-lg px-3 py-2.5 text-[12px] font-medium transition ${mode === "bulk" ? "bg-white/[0.1] text-white" : "text-[#8b92a5] hover:text-white"}`}
              >
                CSV Campaign
              </button>
            </div>

            {/* Token */}
            <div>
              <label className={LABEL}>Token</label>
              <TokenPickerButton mintAddress={mintAddress} onSelect={handleTokenSelect} autoWrap={useAutoWrap} error={undefined} />
            </div>

            {mode === "single" ? (
              <Field
                label={manualCreatesCampaign ? "Beneficiary for This Campaign" : "Recipient"}
                input={
                  <input
                    type="text"
                    placeholder="Solana wallet address..."
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className={`${INPUT} font-mono ${formErrors.recipient ? INPUT_ERR : ""}`}
                  />
                }
                error={formErrors.recipient}
                hint={
                  manualCreatesCampaign
                    ? "All milestone leaves in this campaign go to this one beneficiary."
                    : "Wallet that can claim this milestone stream."
                }
              />
            ) : (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                <p className="text-[12px] font-medium text-white">Recipients come from the CSV file</p>
                <p className="mt-1 text-[12px] text-[#8b92a5]">
                  Paste one or more beneficiary rows below. You do not need to enter a separate recipient here.
                </p>
              </div>
            )}

            {/* Cancellation */}
            <ToggleCard checked={cancellable} onChange={setCancellable} title="Allow cancellation?" body="Creator can cancel and reclaim unvested tokens." />
          </div>

          {/* Milestone Cards (Manual Mode) */}
          {mode === "single" && mintAddress && (
            <>
              {milestones.map((milestone, i) => (
                <div key={milestone.id} className={`${CARD} space-y-4 p-5`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-bold text-violet-400">{i}</span>
                      <p className="text-[13px] font-medium text-white">
                        {manualCreatesCampaign ? `Campaign Milestone #${i}` : `Milestone #${i}`}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => duplicateMilestone(i)} className="rounded-md border border-white/[0.08] px-2 py-1 text-[10px] text-[#8b92a5] hover:text-white">
                        Duplicate
                      </button>
                      {milestones.length > 1 && (
                        <button type="button" onClick={() => removeMilestone(i)} className="rounded-md border border-red-500/20 px-2 py-1 text-[10px] text-red-400 hover:text-red-300">
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <Field
                    label={`Amount${effectiveMintDecimals !== null ? ` (${effectiveMintDecimals} decimals)` : ""}`}
                    input={
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="e.g. 1000"
                          value={milestone.amount}
                          onChange={(e) => updateMilestone(milestone.id, "amount", e.target.value)}
                          className={`${INPUT} pr-24 ${formErrors[`amount_${i}`] ? INPUT_ERR : ""}`}
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                          <span className="text-[10px] text-[#555d73]">{tokenSymbol}</span>
                          <button
                            type="button"
                            onClick={() => { if (walletToken) updateMilestone(milestone.id, "amount", walletToken.uiAmount); }}
                            className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-[#8b92a5] hover:text-white"
                          >
                            Max
                          </button>
                        </div>
                      </div>
                    }
                    error={formErrors[`amount_${i}`]}
                  />

                  {/* Unlock Time */}
                  <Field
                    label="Earliest Unlock Time (optional)"
                    input={
                      <input
                        type="datetime-local"
                        value={milestone.unlockTime}
                        onChange={(e) => updateMilestone(milestone.id, "unlockTime", e.target.value)}
                        className={INPUT}
                      />
                    }
                    hint="Claim opens only after this time and after the creator releases the milestone. Defaults to now if empty."
                  />
                </div>
              ))}

              {/* Add Milestone Button */}
              {milestones.length >= 256 ? (
                <p className="text-center text-[12px] text-amber-400/80">
                  Maximum 256 milestones reached (on-chain bitmap limit).
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setMilestones((prev) => [...prev, newMilestone()])}
                  className="w-full rounded-xl border border-dashed border-white/[0.12] py-3 text-[13px] font-medium text-[#8b92a5] transition hover:border-white/[0.2] hover:text-white"
                >
                  + Add Milestone ({milestones.length}/256)
                </button>
              )}
            </>
          )}

          {/* CSV Mode */}
          {mode === "bulk" && mintAddress && (
            <BulkCsvSection
              mintAddress={mintAddress}
              onMintAddressChange={(v) => setMintAddress(v)}
              mintDecimals={effectiveMintDecimals}
              mintLoading={false}
              campaignId={bulkCampaignId}
              onCampaignIdChange={() => {}}
              cancellable={cancellable}
              onCancellableChange={setCancellable}
              csvText={csvText}
              onCsvTextChange={(v) => { setCsvText(v); setCsvResult(null); setTxState({ type: "idle" }); }}
              onParse={handleCsvParse}
              csvTemplate={bulkCsvTemplateForType("milestone")}
              csvResult={csvResult}
              prepared={prepared}
              vestingType="milestone"
            />
          )}

          {/* Results */}
          {txState.type === "success" && (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-emerald-400">Milestone stream created!</p>
              {txState.results.map((r) => (
                <TxResultCard key={r.sig} title="Milestone Stream" sig={r.sig} href={r.shareUrl} linkLabel="Open stream" />
              ))}
            </div>
          )}
          {txState.type === "error" && <ErrorCard title="Transaction Failed" body={txState.msg} />}
          {txState.type === "bulk-funded" && (
            <TxResultCard
              title={`Campaign created — ${txState.prepared.leaves.length} milestones`}
              sig={txState.sig}
              href={`/campaign/${txState.treeAddress}`}
              linkLabel="View campaign"
            />
          )}
        </div>

        {/* Sidebar */}
        <FormSummary
          amount={mode === "single" ? String(totalAmount || "") : (prepared && effectiveMintDecimals !== null ? String(Number(prepared.totalSupply) / 10 ** effectiveMintDecimals) : (prepared?.totalSupply ?? "0"))}
          tokenSymbol={tokenSymbol}
          tokenBalance={tokenBalance}
          streamCount={mode === "single" ? milestones.length : 1}
          mode={mode === "bulk" || manualCreatesCampaign ? "bulk" : "single"}
          submitLabel={
            mode === "bulk"
              ? "Create & Fund Campaign"
              : manualCreatesCampaign
                ? `Create Campaign (${milestones.length} Milestones)`
                : "Create Milestone Stream"
          }
          loading={txState.type === "loading"}
          disabled={
            mode === "single"
              ? !mintAddress || !recipient || milestones.some((m) => !m.amount)
              : txState.type !== "bulk-ready"
          }
          onSubmit={
            mode === "single"
              ? handleSubmit
              : handleBulkCreate
          }
        />
      </div>
    </div>
  );
}
