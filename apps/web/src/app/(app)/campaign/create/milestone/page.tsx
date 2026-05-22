"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { datetimeLocalToUnix } from "@/lib/stream/datetime";
import { validatePublicKey, validateAmountWithDecimals, hasErrors } from "@/lib/validation/stream-form";
import { getMilestoneCampaignId } from "@/lib/campaign/milestone-ids";
import { bulkCsvTemplateForType, parseBulkCsv, prepareBulkCampaign, type BulkCsvParseResult, type PreparedBulkCampaign } from "@/lib/campaign/bulk";
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
  | { type: "partial"; results: CreateStreamResult[]; total: number; errorMsg: string }
  | { type: "error"; msg: string }
  | { type: "bulk-ready"; prepared: PreparedBulkCampaign }
  | { type: "bulk-created"; sig: string; treeAddress: string; totalSupply: string; prepared: PreparedBulkCampaign }
  | { type: "bulk-funded"; sig: string; treeAddress: string; prepared: PreparedBulkCampaign };

type Mode = "single" | "bulk";

function newMilestone(): MilestoneEntry {
  return { id: crypto.randomUUID(), amount: "", unlockTime: "" };
}

export default function MilestoneCreatePage() {
  const { publicKey } = useWallet();
  const { createStream, formatVestingError } = useCreateStream();
  const { createCampaign, fundCampaign, formatVestingError: formatCampaignError } = useCreateCampaign();
  const { tokens: walletTokens } = useWalletTokens();
  const { toast } = useToast();

  // General
  const [mode, setMode] = useState<Mode>("single");
  const [mintAddress, setMintAddress] = useState("");
  const [mintDecimals, setMintDecimals] = useState<number | null>(null);
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
  const tokenSymbol = tokenInfo?.symbol ?? (mintAddress ? mintAddress.slice(0, 4) : "");
  const walletToken = walletTokens.find((t) => t.mintAddress === mintAddress);
  const tokenBalance = walletToken?.uiAmount ?? null;
  const totalAmount = milestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

  // Bulk handlers
  function handleCsvParse() {
    if (!csvText.trim()) return;
    const result = parseBulkCsv(csvText, mintDecimals);
    setCsvResult(result);
    if (result.issues.length === 0 && result.rows.length > 0) {
      setTxState({ type: "bulk-ready", prepared: prepareBulkCampaign(result.rows) });
    } else {
      setTxState({ type: "idle" });
    }
  }

  async function handleBulkCreate() {
    if (txState.type !== "bulk-ready") return;
    setTxState({ type: "loading", label: "Creating campaign..." });
    try {
      const result = await createCampaign({ mintAddress, campaignId: bulkCampaignId, prepared: txState.prepared, cancellable });
      toast("Campaign created! Now fund the vault.", "success");
      setTxState({ type: "bulk-created", sig: result.sig, treeAddress: result.treeAddress, totalSupply: result.totalSupply, prepared: txState.prepared });
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast("Transaction rejected", "error");
        setTxState({ type: "bulk-ready", prepared: txState.prepared });
        return;
      }
      setTxState({ type: "error", msg: formatCampaignError(error) });
    }
  }

  async function handleBulkFund() {
    if (txState.type !== "bulk-created") return;
    const currentState = txState;
    setTxState({ type: "loading", label: "Funding vault..." });
    try {
      const result = await fundCampaign({ mintAddress, treeAddress: currentState.treeAddress, totalSupply: currentState.totalSupply });
      toast("Campaign funded!", "success");
      setTxState({ type: "bulk-funded", sig: result.sig, treeAddress: result.treeAddress, prepared: currentState.prepared });
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast("Transaction rejected", "error");
        setTxState(currentState);
        return;
      }
      setTxState({ type: "error", msg: formatCampaignError(error) });
    }
  }

  const prepared = txState.type === "bulk-ready" || txState.type === "bulk-created" || txState.type === "bulk-funded" ? txState.prepared : null;

  function handleTokenSelect(mint: string, decimals: number) {
    setMintAddress(mint);
    setMintDecimals(decimals);
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

  async function handleSubmit() {
    if (!publicKey || !mintAddress) return;

    // Validate
    const errors: Record<string, string | null> = {};
    const recipErr = validatePublicKey(recipient);
    if (recipErr) errors.recipient = recipErr;
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      const amtErr = validateAmountWithDecimals(m.amount, mintDecimals);
      if (amtErr) errors[`amount_${i}`] = amtErr;
    }
    setFormErrors(errors);
    if (hasErrors(errors)) return;

    setTxState({ type: "loading", label: `Creating milestone 1 of ${milestones.length}...` });
    const results: CreateStreamResult[] = [];

    try {
      const now = Math.floor(Date.now() / 1000);

      for (let i = 0; i < milestones.length; i++) {
        setTxState({ type: "loading", label: `Creating milestone ${i + 1} of ${milestones.length}...` });
        const m = milestones[i];
        const unlockUnix = m.unlockTime ? datetimeLocalToUnix(m.unlockTime) : now + 60;

        const result = await createStream({
          beneficiary: recipient,
          mintAddress,
          amount: m.amount,
          mintDecimals,
          campaignId: String(getMilestoneCampaignId(baseCampaignId, i)),
          releaseType: 2,
          startTime: now - 60,
          cliffTime: unlockUnix,
          endTime: unlockUnix,
          milestoneIdx: i,
          cancellable,
        });
        results.push(result);
      }

      toast(`${results.length} milestone stream(s) created!`, "success");
      setTxState({ type: "success", results });
      setMilestones([newMilestone()]);
      setFormErrors({});
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast("Transaction rejected by wallet", "error");
        if (results.length > 0) {
          setTxState({ type: "partial", results, total: milestones.length, errorMsg: "User rejected" });
        } else {
          setTxState({ type: "idle" });
        }
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
                Use CSV
              </button>
            </div>

            {/* Token */}
            <div>
              <label className={LABEL}>Token</label>
              <TokenPickerButton mintAddress={mintAddress} onSelect={handleTokenSelect} error={undefined} />
            </div>

            {/* Recipient */}
            <Field
              label="Recipient"
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
              hint="All milestones in this campaign go to this recipient"
            />

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
                      <p className="text-[13px] font-medium text-white">Milestone #{i}</p>
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
                    label={`Amount${mintDecimals !== null ? ` (${mintDecimals} decimals)` : ""}`}
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
                    hint="Recipient can claim after this time AND creator triggers release. Defaults to now if empty."
                  />
                </div>
              ))}

              {/* Add Milestone Button */}
              <button
                type="button"
                onClick={() => setMilestones((prev) => [...prev, newMilestone()])}
                className="w-full rounded-xl border border-dashed border-white/[0.12] py-3 text-[13px] font-medium text-[#8b92a5] transition hover:border-white/[0.2] hover:text-white"
              >
                + Add Milestone
              </button>
            </>
          )}

          {/* CSV Mode */}
          {mode === "bulk" && mintAddress && (
            <BulkCsvSection
              mintAddress={mintAddress}
              onMintAddressChange={(v) => setMintAddress(v)}
              mintDecimals={mintDecimals}
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
              <p className="text-[13px] font-medium text-emerald-400">{txState.results.length} milestone stream(s) created!</p>
              {txState.results.map((r, i) => (
                <TxResultCard key={r.sig} title={`Milestone #${i}`} sig={r.sig} href={r.shareUrl} linkLabel="Open stream" />
              ))}
            </div>
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
                    <span className="text-[#8b92a5]">Milestone #{i}</span>
                    <a href={r.shareUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-white/70 underline">{r.sig.slice(0, 8)}…</a>
                  </li>
                ))}
                {Array.from({ length: txState.total - txState.results.length }, (_, i) => (
                  <li key={`failed-${i}`} className="flex items-center gap-2 text-[11px]">
                    <span className="text-red-400">✗</span>
                    <span className="text-[#8b92a5]">Milestone #{txState.results.length + i} — failed</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-red-300">{txState.errorMsg}</p>
            </div>
          )}
          {txState.type === "error" && <ErrorCard title="Transaction Failed" body={txState.msg} />}
          {txState.type === "bulk-created" && <TxResultCard title="Campaign created!" sig={txState.sig} href={`/campaign/${txState.treeAddress}`} linkLabel="View campaign" />}
          {txState.type === "bulk-funded" && <TxResultCard title="Campaign funded!" sig={txState.sig} href={`/campaign/${txState.treeAddress}`} linkLabel="View campaign" />}
        </div>

        {/* Sidebar */}
        <FormSummary
          amount={mode === "single" ? String(totalAmount || "") : (prepared && mintDecimals !== null ? String(Number(prepared.totalSupply) / 10 ** mintDecimals) : (prepared?.totalSupply ?? "0"))}
          tokenSymbol={tokenSymbol}
          tokenBalance={tokenBalance}
          streamCount={1}
          mode={mode === "single" ? "single" : "bulk"}
          submitLabel={
            mode === "bulk"
              ? (txState.type === "bulk-created" ? "Step 2: Fund Vault" : "Step 1: Create Campaign")
              : `Create ${milestones.length} Milestone${milestones.length > 1 ? "s" : ""}`
          }
          loading={txState.type === "loading"}
          disabled={
            mode === "single"
              ? !mintAddress || !recipient || milestones.some((m) => !m.amount)
              : txState.type !== "bulk-ready" && txState.type !== "bulk-created"
          }
          onSubmit={
            mode === "single"
              ? handleSubmit
              : txState.type === "bulk-created" ? handleBulkFund : handleBulkCreate
          }
        />
      </div>
    </div>
  );
}
