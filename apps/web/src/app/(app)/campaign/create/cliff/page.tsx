"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { datetimeLocalToUnix } from "@/lib/stream/datetime";
import { validatePublicKey, validateAmountWithDecimals, validateSchedule, hasErrors } from "@/lib/validation/stream-form";
import { bulkCsvTemplateForType, parseBulkCsv, prepareBulkCampaign, toRawAmount, type BulkCsvParseResult, type BulkCsvRow, type PreparedBulkCampaign } from "@/lib/campaign/bulk";
import { useCreateCampaign } from "@/hooks/useCreateCampaign";
import { useCreateStream, type CreateStreamResult } from "@/hooks/useCreateStream";
import { useWalletTokens } from "@/hooks/useWalletTokens";
import { useToast } from "@/components/shell/Toast";
import { CARD, INPUT, INPUT_ERR, LABEL, SectionHeader, Field, ToggleCard, TxResultCard, ErrorCard, formatTokenAmount, formatUnixToDate, formatDurationSeconds } from "@/components/campaign/create/shared";
import { BulkCsvSection } from "@/components/campaign/create/BulkCsvSection";
import { FormSummary, type BulkReviewData } from "@/components/campaign/create/FormSummary";
import { PageHeader } from "@/components/campaign/create/PageHeader";
import { TokenPickerButton } from "@/components/campaign/create/TokenPickerButton";
import { PendingFundingsPanel } from "@/components/campaign/create/PendingFundingsPanel";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import {
  listPendingCampaignFundingsLocal,
  removePendingCampaignFundingLocal,
  type PendingCampaignFundingPayload,
} from "@/lib/stream/persist";

type Mode = "single" | "bulk";

type StreamEntry = {
  id: string;
  recipient: string;
  amount: string;
  cliffTime: string;
  startTime: string;
};

type TxState =
  | { type: "idle" }
  | { type: "loading"; label: string }
  | { type: "success"; results: CreateStreamResult[] }
  | { type: "error"; msg: string }
  | { type: "bulk-ready"; prepared: PreparedBulkCampaign }
  | {
      type: "bulk-created-unfunded";
      createSig: string;
      treeAddress: string;
      totalSupply: string;
      prepared: PreparedBulkCampaign;
      msg: string;
    }
  | { type: "bulk-funded"; sig: string; treeAddress: string; prepared: PreparedBulkCampaign };

function newStream(): StreamEntry {
  return { id: crypto.randomUUID(), recipient: "", amount: "", cliffTime: "", startTime: "" };
}

function waitForLoadingPaint() {
  return new Promise<void>((resolve) => setTimeout(resolve, 250));
}

export default function CliffCreatePage() {
  const { publicKey } = useWallet();
  const { createStream, formatVestingError: formatStreamError } = useCreateStream();
  const {
    createCampaign,
    fundCampaign,
    formatVestingError: formatCampaignError,
  } = useCreateCampaign();
  const { tokens: walletTokens } = useWalletTokens();
  const { toast } = useToast();

  // General
  const [mode, setMode] = useState<Mode>("single");
  const [mintAddress, setMintAddress] = useState("");
  const [mintDecimals, setMintDecimals] = useState<number | null>(null);
  const [useAutoWrap, setUseAutoWrap] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [baseCampaignId, setBaseCampaignId] = useState(() => Math.floor(Date.now() / 1000) % 1000000);

  // Stream entries (manual mode)
  const [streams, setStreams] = useState<StreamEntry[]>([newStream()]);
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({});
  const [txState, setTxState] = useState<TxState>({ type: "idle" });

  // Bulk state
  const [csvText, setCsvText] = useState("");
  const [csvResult, setCsvResult] = useState<BulkCsvParseResult | null>(null);
  const [bulkCampaignId] = useState(() => String(Math.floor(Date.now() / 1000) % 1000000));
  const [pendingFundings, setPendingFundings] = useState<PendingCampaignFundingPayload[]>([]);

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
  const totalAmount = streams.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  const validateField = (key: string, value: string, type: "recipient" | "amount" | "cliff") => {
    let err: string | null = null;
    if (type === "recipient") err = validatePublicKey(value);
    else if (type === "amount") err = validateAmountWithDecimals(value, effectiveMintDecimals);
    else if (type === "cliff") err = value ? null : "Cliff date is required.";
    setFormErrors((prev) => ({ ...prev, [key]: err }));
  };

  const refreshPendingFundings = useCallback(() => {
    if (!publicKey) {
      setPendingFundings([]);
      return;
    }
    const owner = publicKey.toBase58();
    setPendingFundings(
      listPendingCampaignFundingsLocal()
        .filter((item) => item.creator === owner)
        .sort((a, b) => b.createdAt - a.createdAt),
    );
  }, [publicKey]);

  useEffect(() => {
    refreshPendingFundings();
  }, [refreshPendingFundings]);

  useEffect(() => {
    const pending = txState.type === "loading" || txState.type === "error";
    if (pending) {
      document.body.dataset.vestingTxPending = "true";
    } else {
      delete document.body.dataset.vestingTxPending;
    }

    return () => {
      delete document.body.dataset.vestingTxPending;
    };
  }, [txState.type]);

  function handleTokenSelect(mint: string, decimals: number, autoWrap?: boolean) {
    const mintChanged = mint !== mintAddress;
    setMintAddress(mint);
    setMintDecimals(decimals);
    setUseAutoWrap(autoWrap ?? false);
    if (mintChanged && mode === "bulk") {
      setCsvText("");
      setCsvResult(null);
      setTxState({ type: "idle" });
      return;
    }
    if (mode === "bulk" && csvText.trim()) {
      runBulkParse(csvText, decimals);
    }
  }

  function updateStream(id: string, field: keyof StreamEntry, value: string) {
    setStreams((prev) => prev.map((s) => s.id === id ? { ...s, [field]: value } : s));
  }

  function duplicateStream(index: number) {
    const source = streams[index];
    setStreams((prev) => [...prev.slice(0, index + 1), { ...source, id: crypto.randomUUID(), recipient: "" }, ...prev.slice(index + 1)]);
  }

  function removeStream(index: number) {
    if (streams.length <= 1) return;
    setStreams((prev) => prev.filter((_, i) => i !== index));
  }

  function runBulkParse(text: string, decimals: number | null) {
    const result = parseBulkCsv(text, decimals, 0);
    setCsvResult(result);
    if (result.issues.length === 0 && result.rows.length > 0) {
      setTxState({ type: "bulk-ready", prepared: prepareBulkCampaign(result.rows) });
    } else {
      setTxState({ type: "idle" });
    }
  }

  function buildManualCampaignRows(): BulkCsvRow[] {
    return streams.map((stream, index) => {
      const c = datetimeLocalToUnix(stream.cliffTime);
      const s = stream.startTime
        ? datetimeLocalToUnix(stream.startTime)
        : Math.min(Math.floor(Date.now() / 1000), c);
      return {
        rowNumber: index + 1,
        beneficiary: stream.recipient.trim(),
        amountInput: stream.amount.trim(),
        amountRaw: effectiveMintDecimals !== null ? toRawAmount(stream.amount.trim(), effectiveMintDecimals) : stream.amount.trim(),
        releaseType: 0,
        startTime: s,
        cliffTime: c,
        endTime: c,
        milestoneIdx: 0,
      };
    });
  }

  async function handleSubmit() {
    if (!publicKey || !mintAddress) return;

    const errors: Record<string, string | null> = {};
    const recipientRows = new Map<string, number[]>();
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i];
      const recipErr = validatePublicKey(s.recipient);
      if (recipErr) errors[`recipient_${i}`] = recipErr;
      else {
        const normalized = s.recipient.trim();
        recipientRows.set(normalized, [...(recipientRows.get(normalized) ?? []), i]);
      }
      const amtErr = validateAmountWithDecimals(s.amount, effectiveMintDecimals);
      if (amtErr) errors[`amount_${i}`] = amtErr;
      if (!s.cliffTime) {
        errors[`cliff_${i}`] = "Cliff date is required.";
      } else {
        const cUnix = datetimeLocalToUnix(s.cliffTime);
        const sUnix = s.startTime
          ? datetimeLocalToUnix(s.startTime)
          : Math.min(Math.floor(Date.now() / 1000), cUnix);
        const schedErr = validateSchedule(sUnix, cUnix, cUnix, 0);
        if (schedErr) errors[`cliff_${i}`] = schedErr;
      }
    }
    for (const indexes of recipientRows.values()) {
      if (indexes.length > 1) {
        for (const index of indexes) {
          errors[`recipient_${index}`] = "Duplicate recipient. Each wallet can only appear once per campaign.";
        }
      }
    }
    setFormErrors(errors);
    if (hasErrors(errors)) return;

    if (streams.length > 1) {
      setTxState({ type: "loading", label: `Creating campaign for ${streams.length} recipients...` });
      await waitForLoadingPaint();
      try {
        const prepared = prepareBulkCampaign(buildManualCampaignRows());
        const created = await createCampaign({
          mintAddress,
          campaignId: String(baseCampaignId),
          prepared,
          cancellable,
        });
        refreshPendingFundings();

        setTxState({ type: "loading", label: "Funding campaign..." });
        try {
          const funded = await fundCampaign({
            mintAddress,
            treeAddress: created.treeAddress,
            totalSupply: created.totalSupply,
            autoWrap: useAutoWrap,
          });
          refreshPendingFundings();
          toast("Campaign created and funded!", "success");
          setTxState({ type: "bulk-funded", sig: funded.sig, treeAddress: created.treeAddress, prepared });
          setStreams([newStream()]);
          setFormErrors({});

          setBaseCampaignId(Math.floor(Date.now() / 1000) % 1000000);
        } catch (error: unknown) {
          if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
            toast("Funding rejected", "error");
          }
          setTxState({
            type: "bulk-created-unfunded",
            createSig: created.sig,
            treeAddress: created.treeAddress,
            totalSupply: created.totalSupply,
            prepared,
            msg: "Campaign created on-chain, but funding was not completed. Resume funding below.",
          });
        }
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

    setTxState({ type: "loading", label: `Creating ${streams.length} cliff stream(s)...` });
    await waitForLoadingPaint();
    const results: CreateStreamResult[] = [];

    try {
      for (let i = 0; i < streams.length; i++) {
        setTxState({ type: "loading", label: `Creating stream ${i + 1} of ${streams.length}...` });
        const s = streams[i];
        const cid = String(baseCampaignId * 100 + i);
        const sCliff = datetimeLocalToUnix(s.cliffTime);
        const sStart = s.startTime
          ? datetimeLocalToUnix(s.startTime)
          : Math.min(Math.floor(Date.now() / 1000), sCliff);

        const result = await createStream({
          beneficiary: s.recipient, mintAddress, amount: s.amount, mintDecimals: effectiveMintDecimals,
          campaignId: cid, releaseType: 0, startTime: sStart, cliffTime: sCliff,
          endTime: sCliff, milestoneIdx: 0, cancellable, autoWrap: useAutoWrap,
        });
        results.push(result);
      }
      toast(`${results.length} cliff stream(s) created!`, "success");
      setTxState({ type: "success", results });
      setStreams([newStream()]);
      setFormErrors({});
      setBaseCampaignId(Math.floor(Date.now() / 1000) % 1000000);
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast("Transaction rejected by wallet", "error");
        if (results.length > 0) {
          setTxState({ type: "success", results });
        } else {
          setTxState({ type: "idle" });
        }
        return;
      }
      if (results.length > 0) {
        toast(`${results.length} of ${streams.length} created. Remaining failed.`, "error");
        setTxState({ type: "success", results });
        return;
      }
      setTxState({ type: "error", msg: formatStreamError(error) });
    }
  }

  // Bulk handlers
  function handleCsvParse() {
    if (!csvText.trim()) return;
    runBulkParse(csvText, effectiveMintDecimals);
  }

  async function handleBulkCreate() {
    if (txState.type !== "bulk-ready") return;
    setTxState({ type: "loading", label: "Creating campaign..." });
    let created: Awaited<ReturnType<typeof createCampaign>>;
    try {
      created = await createCampaign({
        mintAddress,
        campaignId: bulkCampaignId,
        prepared: txState.prepared,
        cancellable,
      });
      refreshPendingFundings();
    } catch (error: unknown) {
      setTxState({ type: "error", msg: formatCampaignError(error) });
      return;
    }

    setTxState({ type: "loading", label: "Funding campaign..." });
    try {
      const funded = await fundCampaign({
        mintAddress,
        treeAddress: created.treeAddress,
        totalSupply: created.totalSupply,
        autoWrap: useAutoWrap,
      });
      toast("Campaign created and funded!", "success");
      refreshPendingFundings();
      setTxState({ type: "bulk-funded", sig: funded.sig, treeAddress: created.treeAddress, prepared: txState.prepared });
      setCsvText("");
      setCsvResult(null);
    } catch (error: unknown) {
      if (error instanceof Error && /User rejected|Connection rejected/i.test(error.message)) {
        toast("Funding rejected", "error");
        setTxState({
          type: "bulk-created-unfunded",
          createSig: created.sig,
          treeAddress: created.treeAddress,
          totalSupply: created.totalSupply,
          prepared: txState.prepared,
          msg: "Campaign created on-chain, but funding was not completed. You can resume funding without creating a new campaign.",
        });
        return;
      }
      setTxState({
        type: "bulk-created-unfunded",
        createSig: created.sig,
        treeAddress: created.treeAddress,
        totalSupply: created.totalSupply,
        prepared: txState.prepared,
        msg: formatCampaignError(error),
      });
    }
  }

  async function handleResumeFunding(params: {
    treeAddress: string;
    mint: string;
    totalSupply: string;
    prepared?: PreparedBulkCampaign;
  }) {
    setTxState({ type: "loading", label: "Funding existing campaign..." });
    try {
      const funded = await fundCampaign({
        mintAddress: params.mint,
        treeAddress: params.treeAddress,
        totalSupply: params.totalSupply,
        autoWrap: useAutoWrap,
      });
      removePendingCampaignFundingLocal(params.treeAddress);
      refreshPendingFundings();
      toast("Campaign funded!", "success");
      if (params.prepared) {
        setTxState({
          type: "bulk-funded",
          sig: funded.sig,
          treeAddress: params.treeAddress,
          prepared: params.prepared,
        });
      } else {
        setTxState({ type: "idle" });
      }
    } catch (error: unknown) {
      setTxState({ type: "error", msg: formatCampaignError(error) });
    }
  }

  const prepared =
    txState.type === "bulk-ready" ||
    txState.type === "bulk-created-unfunded" ||
    txState.type === "bulk-funded"
      ? txState.prepared
      : null;

  const bulkReview: BulkReviewData | null =
    prepared && effectiveMintDecimals !== null
      ? (() => {
          const starts = prepared.leaves.map((l) => Number(l.startTime));
          const ends = prepared.leaves.map((l) => Number(l.endTime));
          const earliest = Math.min(...starts);
          const latest = Math.max(...ends);
          const { cliff, linear, milestone } = prepared.releaseMix;
          const releaseType =
            cliff && !linear && !milestone
              ? "Cliff"
              : !cliff && linear && !milestone
              ? "Linear"
              : !cliff && !linear && milestone
              ? "Milestone"
              : "Mixed";
          return {
            recipients: prepared.leafCount,
            tokenSymbol,
            totalSupply: `${formatTokenAmount(prepared.totalSupply, effectiveMintDecimals)}${tokenSymbol ? ` ${tokenSymbol}` : ""}`,
            releaseType,
            earliestStart: formatUnixToDate(earliest),
            latestEnd: formatUnixToDate(latest),
            duration: formatDurationSeconds(latest - earliest),
          };
        })()
      : null;

  if (!publicKey) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Cliff Vesting" description="All tokens unlock at a single date. Nothing before, everything after." />
        <div className={`${CARD} p-5`}>
          <p className="text-[13px] text-muted-foreground">Connect your wallet to create a cliff vesting stream.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <PageHeader title="Cliff Vesting" description="All tokens unlock at a single date. Nothing before, everything after." />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <PendingFundingsPanel
            items={pendingFundings}
            walletTokens={walletTokens}
            onResume={(pending) => handleResumeFunding({
              treeAddress: pending.treeAddress,
              mint: pending.mint,
              totalSupply: pending.totalSupply,
            })}
          />

          {/* General Details Card */}
          <div className={`${CARD} space-y-4 p-5`}>
            <SectionHeader title="General Details" caption="Token and campaign settings" />

            {/* Mode Toggle */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setMode("single"); setTxState({ type: "idle" }); }}
                className={`flex-1 rounded-lg px-3 py-2.5 text-[12px] font-medium transition ${mode === "single" ? "bg-foreground/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => { setMode("bulk"); setTxState({ type: "idle" }); }}
                className={`flex-1 rounded-lg px-3 py-2.5 text-[12px] font-medium transition ${mode === "bulk" ? "bg-foreground/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Use CSV
              </button>
            </div>

            {/* Token */}
            <div>
              <label className={LABEL}>Token</label>
              <TokenPickerButton mintAddress={mintAddress} onSelect={handleTokenSelect} autoWrap={useAutoWrap} error={undefined} />
            </div>

            {/* Cancellation */}
            <ToggleCard checked={cancellable} onChange={setCancellable} title="Allow cancellation?" body="Creator can cancel and reclaim unvested tokens after a 7-day grace period." />
          </div>

          {/* Manual Mode: Stream Cards */}
          {mode === "single" && (
            <>
              {streams.map((stream, i) => (
                <div key={stream.id} className={`${CARD} space-y-4 p-5`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium text-foreground">{streams.length > 1 ? `Recipient #${i + 1}` : `Stream #${i + 1}`}</p>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => duplicateStream(i)} className="rounded-md border border-foreground/[0.08] px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground" title="Add recipient">
                        Add Recipient
                      </button>
                      {streams.length > 1 && (
                        <button type="button" onClick={() => removeStream(i)} className="rounded-md border border-red-500/20 px-2 py-1 text-[10px] text-red-700 dark:text-red-400 hover:text-red-600 dark:text-red-300" title="Remove">
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
                          value={stream.amount}
                          onChange={(e) => updateStream(stream.id, "amount", e.target.value)}
                          onBlur={(e) => validateField(`amount_${i}`, e.target.value, "amount")}
                          className={`${INPUT} pr-24 ${formErrors[`amount_${i}`] ? INPUT_ERR : ""}`}
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">{tokenSymbol}</span>
                          <button
                            type="button"
                            onClick={() => { if (walletToken) updateStream(stream.id, "amount", walletToken.uiAmount); }}
                            className="rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                          >
                            Max
                          </button>
                        </div>
                      </div>
                    }
                    error={formErrors[`amount_${i}`]}
                  />

                  {/* Recipient */}
                  <Field
                    label="Recipient"
                    input={
                      <input
                        type="text"
                        placeholder="Solana wallet address..."
                        value={stream.recipient}
                        onChange={(e) => updateStream(stream.id, "recipient", e.target.value)}
                        onBlur={(e) => validateField(`recipient_${i}`, e.target.value, "recipient")}
                        className={`${INPUT} font-mono ${formErrors[`recipient_${i}`] ? INPUT_ERR : ""}`}
                      />
                    }
                    error={formErrors[`recipient_${i}`]}
                  />

                  {/* Cliff Date */}
                  <Field
                    label="Cliff Date (Full Unlock)"
                    input={
                      <div className="flex gap-2">
                        <input
                          type="datetime-local"
                          value={stream.cliffTime}
                          onChange={(e) => updateStream(stream.id, "cliffTime", e.target.value)}
                          onBlur={(e) => validateField(`cliff_${i}`, e.target.value, "cliff")}
                          className={`${INPUT} flex-1 ${formErrors[`cliff_${i}`] ? INPUT_ERR : ""}`}
                        />
                        {streams.length > 1 && stream.cliffTime && (
                          <button
                            type="button"
                            onClick={() => setStreams((prev) => prev.map((s) => ({ ...s, cliffTime: stream.cliffTime, startTime: stream.startTime || s.startTime })))}
                            className="shrink-0 rounded-md border border-foreground/[0.08] px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                            title="Apply this date to all streams"
                          >
                            Apply all
                          </button>
                        )}
                      </div>
                    }
                    error={formErrors[`cliff_${i}`]}
                  />

                  {/* Start Time */}
                  <Field
                    label="Start Time (optional)"
                    input={
                      <input
                        type="datetime-local"
                        value={stream.startTime}
                        onChange={(e) => updateStream(stream.id, "startTime", e.target.value)}
                        className={INPUT}
                      />
                    }
                    hint="Defaults to now if empty"
                  />
                </div>
              ))}

              {/* Add Stream Button */}
              <button
                type="button"
                onClick={() => setStreams((prev) => [...prev, newStream()])}
                className="w-full rounded-xl border border-dashed border-foreground/[0.12] py-3 text-[13px] font-medium text-muted-foreground transition hover:border-foreground/[0.2] hover:text-foreground"
              >
                + Add Recipient
              </button>
            </>
          )}

          {/* CSV Mode */}
          {mode === "bulk" && (
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
              csvTemplate={bulkCsvTemplateForType("cliff")}
              csvResult={csvResult}
              prepared={prepared}
              vestingType="cliff"
              tokenSymbol={tokenSymbol}
            />
          )}

          {/* Results */}
          {txState.type === "success" && (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400">{txState.results.length} cliff stream(s) created!</p>
              {txState.results.map((r, i) => (
                <TxResultCard key={r.sig} title={`Stream #${i + 1}`} sig={r.sig} href={r.shareUrl} linkLabel="Open stream" />
              ))}
            </div>
          )}
          {txState.type === "bulk-created-unfunded" && (
            <div className={`${CARD} p-5`}>
              <p className="text-[13px] font-medium text-amber-700 dark:text-amber-300">Campaign created, funding pending</p>
              <p className="mt-2 text-[12px] leading-6 text-warning">{txState.msg}</p>
              <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">Create signature: {txState.createSig}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleResumeFunding({
                    treeAddress: txState.treeAddress,
                    mint: mintAddress,
                    totalSupply: txState.totalSupply,
                    prepared: txState.prepared,
                  })}
                  className="rounded-lg bg-amber-400 px-3 py-2 text-[12px] font-semibold text-black"
                >
                  Resume funding
                </button>
                <a
                  href={`/campaign/${txState.treeAddress}`}
                  className="rounded-lg border border-foreground/[0.12] px-3 py-2 text-[12px] font-medium text-foreground"
                >
                  View campaign
                </a>
              </div>
            </div>
          )}
          {txState.type === "bulk-funded" && <TxResultCard title="Campaign funded!" sig={txState.sig} href={`/campaign/${txState.treeAddress}`} linkLabel="View campaign" />}
          {txState.type === "error" && <ErrorCard title="Transaction Failed" body={txState.msg} />}
        </div>

        {/* Sidebar */}
        <FormSummary
          amount={mode === "single" ? String(totalAmount || "") : (prepared && effectiveMintDecimals !== null ? String(Number(prepared.totalSupply) / 10 ** effectiveMintDecimals) : (prepared?.totalSupply ?? "0"))}
          tokenSymbol={tokenSymbol}
          tokenBalance={tokenBalance}
          streamCount={mode === "single" ? streams.length : 1}
          mode={mode === "bulk" || (mode === "single" && streams.length > 1) ? "bulk" : "single"}
          submitLabel={
            mode === "bulk"
              ? "Create & Fund Campaign"
              : streams.length > 1
                ? `Create Campaign (${streams.length} Recipients)`
                : "Create Cliff Stream"
          }
          loading={txState.type === "loading"}
          disabled={
            mode === "single"
              ? !mintAddress || streams.some((s) => !s.amount || !s.recipient || !s.cliffTime)
              : txState.type !== "bulk-ready"
          }
          onSubmit={
            mode === "single"
              ? handleSubmit
              : handleBulkCreate
          }
          bulkReview={mode === "bulk" ? bulkReview : null}
        />
      </div>
    </div>
  );
}
