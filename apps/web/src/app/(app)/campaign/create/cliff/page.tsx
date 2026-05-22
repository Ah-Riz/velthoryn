"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { datetimeLocalToUnix } from "@/lib/stream/datetime";
import { validateCreateStreamForm, validatePublicKey, hasErrors, type FormErrors } from "@/lib/validation/stream-form";
import { bulkCsvTemplateForType, parseBulkCsv, prepareBulkCampaign, type BulkCsvParseResult, type PreparedBulkCampaign } from "@/lib/campaign/bulk";
import { useCreateCampaign } from "@/hooks/useCreateCampaign";
import { useCreateStream, type CreateStreamResult } from "@/hooks/useCreateStream";
import { useWalletTokens } from "@/hooks/useWalletTokens";
import { useToast } from "@/components/shell/Toast";
import { CARD, INPUT, INPUT_ERR, LABEL, SECTION, SectionHeader, Field, ToggleCard, TxResultCard, ErrorCard } from "@/components/campaign/create/shared";
import { BulkCsvSection } from "@/components/campaign/create/BulkCsvSection";
import { CreationModeTabs } from "@/components/campaign/create/CreationModeTabs";
import { FormSummary } from "@/components/campaign/create/FormSummary";
import { PageHeader } from "@/components/campaign/create/PageHeader";
import { TokenPickerButton } from "@/components/campaign/create/TokenPickerButton";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";

type Mode = "single" | "bulk";
type TxState =
  | { type: "idle" }
  | { type: "loading"; label: string }
  | { type: "success"; result: CreateStreamResult }
  | { type: "error"; msg: string }
  | { type: "bulk-ready"; prepared: PreparedBulkCampaign }
  | { type: "bulk-created"; sig: string; treeAddress: string; totalSupply: string; prepared: PreparedBulkCampaign }
  | { type: "bulk-funded"; sig: string; treeAddress: string; prepared: PreparedBulkCampaign };

export default function CliffCreatePage() {
  const { publicKey } = useWallet();
  const { createStream, formatVestingError: formatStreamError } = useCreateStream();
  const { createCampaign, fundCampaign, formatVestingError: formatCampaignError } = useCreateCampaign();
  const { tokens: walletTokens } = useWalletTokens();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>("single");
  const [beneficiaries, setBeneficiaries] = useState<string[]>([""]);
  const [mintAddress, setMintAddress] = useState("");
  const [mintDecimals, setMintDecimals] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [campaignId] = useState(() => String(Math.floor(Date.now() / 1000) % 1000000));
  const [startTime, setStartTime] = useState("");
  const [cliffTime, setCliffTime] = useState("");
  const [cancellable, setCancellable] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [txState, setTxState] = useState<TxState>({ type: "idle" });

  // Bulk state
  const [csvText, setCsvText] = useState("");
  const [csvResult, setCsvResult] = useState<BulkCsvParseResult | null>(null);
  const [bulkMint, setBulkMint] = useState("");
  const [bulkDecimals, setBulkDecimals] = useState<number | null>(null);
  const [bulkCampaignId] = useState(() => String(Math.floor(Date.now() / 1000) % 1000000));
  const [bulkCancellable, setBulkCancellable] = useState(false);

  // Derived
  const tokenInfo = POPULAR_TOKENS.find((t) => t.mint === mintAddress);
  const tokenSymbol = tokenInfo?.symbol ?? (mintAddress ? mintAddress.slice(0, 4) : "");
  const walletToken = walletTokens.find((t) => t.mintAddress === mintAddress);
  const tokenBalance = walletToken?.uiAmount ?? null;

  function handleTokenSelect(mint: string, decimals: number) {
    setMintAddress(mint);
    setMintDecimals(decimals);
  }

  function handleMaxAmount() {
    if (walletToken) setAmount(walletToken.uiAmount);
  }

  async function handleSingleSubmit() {
    if (!publicKey) return;
    const startUnix = startTime ? datetimeLocalToUnix(startTime) : Number.NaN;
    const cliffUnix = cliffTime ? datetimeLocalToUnix(cliffTime) : Number.NaN;

    const errors = validateCreateStreamForm({
      beneficiary: beneficiaries[0], mintAddress, amount, mintDecimals, campaignId,
      startUnix, cliffUnix, endUnix: cliffUnix, releaseType: 0, milestoneIdx: "0",
    });

    const validBeneficiaries = beneficiaries.filter((b) => b.trim());
    if (validBeneficiaries.length === 0) { errors.beneficiary = "At least one recipient required."; }
    for (let i = 0; i < validBeneficiaries.length; i++) {
      const addrErr = validatePublicKey(validBeneficiaries[i]);
      if (addrErr) { errors[`beneficiary_${i}`] = addrErr; }
    }

    setFormErrors(errors);
    if (hasErrors(errors)) return;

    setTxState({ type: "loading", label: `Creating ${validBeneficiaries.length} cliff stream(s)...` });
    try {
      let lastResult: CreateStreamResult | null = null;
      for (let i = 0; i < validBeneficiaries.length; i++) {
        const cid = validBeneficiaries.length === 1 ? campaignId : String(Number(campaignId) * 100 + i);
        lastResult = await createStream({
          beneficiary: validBeneficiaries[i], mintAddress, amount, mintDecimals, campaignId: cid,
          releaseType: 0, startTime: startUnix, cliffTime: cliffUnix, endTime: cliffUnix, milestoneIdx: 0, cancellable,
        });
      }
      toast(`${validBeneficiaries.length} cliff stream(s) created!`, "success");
      if (lastResult?.indexWarning) toast(lastResult.indexWarning, "info");
      setTxState({ type: "success", result: lastResult! });
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast("Transaction rejected by wallet", "error");
        setTxState({ type: "idle" });
        return;
      }
      setTxState({ type: "error", msg: formatStreamError(error) });
    }
  }

  function handleCsvParse() {
    if (!csvText.trim()) return;
    const result = parseBulkCsv(csvText, bulkDecimals);
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
      const result = await createCampaign({ mintAddress: bulkMint, campaignId: bulkCampaignId, prepared: txState.prepared, cancellable: bulkCancellable });
      toast("Campaign created! Now fund the vault.", "success");
      if (result.indexWarning) toast(result.indexWarning, "info");
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
      const result = await fundCampaign({ mintAddress: bulkMint, treeAddress: currentState.treeAddress, totalSupply: currentState.totalSupply });
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

  if (!publicKey) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Cliff Vesting" description="All tokens unlock at a single date. Nothing before, everything after." />
        <div className={`${CARD} p-5`}>
          <p className="text-[13px] text-[#8b92a5]">Connect your wallet to create a cliff vesting stream.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <PageHeader title="Cliff Vesting" description="All tokens unlock at a single date. Nothing before, everything after." />

      <CreationModeTabs mode={mode} onChange={(m) => { setMode(m); setTxState({ type: "idle" }); }} tone="amber" />

      {mode === "single" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {/* Token & Amount Card */}
            <div className={`${CARD} space-y-4 p-5`}>
              <SectionHeader title="Token & Amount" caption="Select the token and amount to lock" />
              <div>
                <label className={LABEL}>Token</label>
                <TokenPickerButton mintAddress={mintAddress} onSelect={handleTokenSelect} error={formErrors.mintAddress} />
              </div>
              {mintAddress && (
                <Field
                  label={`Amount${mintDecimals !== null ? ` (${mintDecimals} decimals)` : ""}`}
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
              )}
            </div>

            {mintAddress && (<>
            {/* Recipient Cards */}
            <div className={`${CARD} space-y-4 p-5`}>
              <div className="flex items-center justify-between">
                <SectionHeader title="Recipients" caption="Wallets that will receive the vested tokens" />
                <button type="button" onClick={() => setBeneficiaries((prev) => [...prev, ""])} className="rounded-md border border-white/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#8b92a5] hover:text-white">
                  + Add
                </button>
              </div>
              {beneficiaries.map((addr, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1">
                    <Field
                      label={beneficiaries.length > 1 ? `Wallet #${i + 1}` : "Beneficiary Wallet"}
                      input={
                        <input
                          type="text"
                          placeholder="Solana wallet address..."
                          value={addr}
                          onChange={(e) => setBeneficiaries((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
                          className={`${INPUT} font-mono ${(formErrors.beneficiary && i === 0) || formErrors[`beneficiary_${i}`] ? INPUT_ERR : ""}`}
                        />
                      }
                      error={formErrors[`beneficiary_${i}`] ?? (i === 0 ? formErrors.beneficiary : undefined)}
                    />
                  </div>
                  {beneficiaries.length > 1 && (
                    <div className="mt-6 flex gap-1">
                      <button type="button" onClick={() => setBeneficiaries((prev) => [...prev.slice(0, i + 1), addr, ...prev.slice(i + 1)])} className="rounded-md border border-white/[0.08] px-2 py-1.5 text-[10px] text-[#8b92a5] hover:text-white" title="Duplicate">
                        ⧉
                      </button>
                      <button type="button" onClick={() => setBeneficiaries((prev) => prev.filter((_, j) => j !== i))} className="rounded-md border border-white/[0.08] px-2 py-1.5 text-[10px] text-red-400 hover:text-red-300" title="Remove">
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Schedule Card */}
            <div className={`${CARD} space-y-4 p-5`}>
              <SectionHeader title="Schedule" caption="When tokens unlock" />
              <Field
                label="Start Date"
                input={<input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} />}
              />
              <Field
                label="Cliff Date (Unlock)"
                input={<input type="datetime-local" value={cliffTime} onChange={(e) => setCliffTime(e.target.value)} className={`${INPUT} ${formErrors.schedule ? INPUT_ERR : ""}`} />}
                error={formErrors.schedule}
              />
              <div className={`${SECTION} flex items-start gap-2`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-amber-400">
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                </svg>
                <p className="text-[12px] leading-5 text-[#8b92a5]">The entire amount unlocks at the cliff date. Nothing is released before.</p>
              </div>
            </div>

            {/* Advanced Settings */}
            <div className={`${CARD} p-5`}>
              <SectionHeader title="Advanced Settings" caption="Optional configuration" />
              <div className="mt-3">
                <ToggleCard checked={cancellable} onChange={setCancellable} title="Allow Cancellation" body="Creator can cancel and reclaim unvested tokens after a 7-day grace period." />
              </div>
            </div>
            </>)}

            {/* Result cards */}
            {txState.type === "success" && <TxResultCard title="Cliff stream created!" sig={txState.result.sig} href={txState.result.shareUrl} linkLabel="Open stream" />}
            {txState.type === "error" && <ErrorCard title="Transaction Failed" body={txState.msg} />}
          </div>

          {/* Sidebar */}
          <FormSummary
            amount={amount}
            tokenSymbol={tokenSymbol}
            tokenBalance={tokenBalance}
            streamCount={beneficiaries.filter((b) => b.trim()).length || 1}
            mode="single"
            submitLabel={`Create ${beneficiaries.filter((b) => b.trim()).length || 1} Cliff Stream${beneficiaries.filter((b) => b.trim()).length > 1 ? "s" : ""}`}
            loading={txState.type === "loading"}
            disabled={!mintAddress || !amount || !beneficiaries[0]?.trim() || !cliffTime}
            onSubmit={handleSingleSubmit}
          />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {/* Token Selection (required first) */}
            <div className={`${CARD} space-y-4 p-5`}>
              <SectionHeader title="Token" caption="Select the token before uploading CSV" />
              <div>
                <label className={LABEL}>Token</label>
                <TokenPickerButton mintAddress={bulkMint} onSelect={(mint, dec) => { setBulkMint(mint); setBulkDecimals(dec); }} error={undefined} />
              </div>
            </div>

            {bulkMint && (
              <BulkCsvSection
                mintAddress={bulkMint}
                onMintAddressChange={(v) => setBulkMint(v)}
                mintDecimals={bulkDecimals}
                mintLoading={false}
                campaignId={bulkCampaignId}
                onCampaignIdChange={() => {}}
                cancellable={bulkCancellable}
                onCancellableChange={setBulkCancellable}
                csvText={csvText}
                onCsvTextChange={(v) => { setCsvText(v); setCsvResult(null); setTxState({ type: "idle" }); }}
                onParse={handleCsvParse}
                csvTemplate={bulkCsvTemplateForType("cliff")}
                csvResult={csvResult}
                prepared={prepared}
                vestingType="cliff"
              />
            )}
          </div>
          <div className="space-y-4">
            <FormSummary
              amount={prepared?.totalSupply ?? "0"}
              tokenSymbol={bulkMint ? bulkMint.slice(0, 4) : ""}
              tokenBalance={null}
              streamCount={1}
              mode="bulk"
              submitLabel={txState.type === "bulk-created" ? "Step 2: Fund Vault" : "Step 1: Create Campaign"}
              loading={txState.type === "loading"}
              disabled={txState.type !== "bulk-ready" && txState.type !== "bulk-created"}
              onSubmit={txState.type === "bulk-created" ? handleBulkFund : handleBulkCreate}
            />
            {txState.type === "bulk-created" && <TxResultCard title="Campaign created!" sig={txState.sig} href={`/campaign/${txState.treeAddress}`} linkLabel="View campaign" />}
            {txState.type === "bulk-funded" && <TxResultCard title="Campaign funded!" sig={txState.sig} href={`/campaign/${txState.treeAddress}`} linkLabel="View campaign" />}
            {txState.type === "error" && <ErrorCard title="Transaction Failed" body={txState.msg} />}
          </div>
        </div>
      )}
    </div>
  );
}
