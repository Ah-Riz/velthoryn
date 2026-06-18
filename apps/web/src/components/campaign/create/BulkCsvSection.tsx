"use client";

import { useEffect, useState } from "react";
import type { BulkCsvParseResult, PreparedBulkCampaign } from "@/lib/campaign/bulk";
import {
  CARD,
  INPUT,
  SummaryRow,
  formatIssueLabel,
  formatTokenAmount,
  formatUnixToDate,
  formatDurationSeconds,
} from "./shared";

type VestingType = "cliff" | "linear" | "milestone";

const COLUMN_GLOSSARY: Record<string, { label: string; desc: string }> = {
  beneficiary: {
    label: "Recipient wallet address",
    desc: "The Solana address of the token recipient",
  },
  amount: {
    label: "Token allocation",
    desc: "Number of tokens to vest for this recipient (e.g. 1000, 2500, 5000)",
  },
  releaseType: {
    label: "Vesting type",
    desc: "Cliff, Linear, or Milestone — must match the current vesting page",
  },
  startTime: {
    label: "Vesting start date",
    desc: "When the vesting period begins · Format: YYYY-MM-DD HH:MM",
  },
  cliffTime: {
    label: "Unlock date",
    desc: "Tokens are locked until this date (cliff = full unlock; linear = earliest vest)",
  },
  endTime: {
    label: "Vesting end date",
    desc: "When all tokens fully unlock · For cliff vesting, set this equal to cliffTime",
  },
  milestoneIdx: {
    label: "Milestone number",
    desc: "Which milestone this row represents · Use 0, 1, 2… (milestone vesting only; set to 0 for cliff/linear)",
  },
};

const COLUMNS_BY_TYPE: Record<VestingType, string[]> = {
  cliff: ["beneficiary", "amount", "releaseType", "startTime", "cliffTime"],
  linear: ["beneficiary", "amount", "releaseType", "startTime", "cliffTime", "endTime", "milestoneIdx"],
  milestone: ["beneficiary", "amount", "releaseType", "startTime", "cliffTime", "endTime", "milestoneIdx"],
};

// ── Icons ──────────────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function UploadCloudIcon({ muted }: { muted?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={muted ? "opacity-30" : ""}
    >
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function XCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function CheckCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CalendarIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// ── Workflow stepper ───────────────────────────────────────────────────────

function WorkflowStep({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: "done" | "active" | "pending";
}) {
  return (
    <div className="flex items-center gap-1.5">
      {state === "done" ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
          <CheckIcon size={8} />
        </span>
      ) : (
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold tabular-nums ${
            state === "active"
              ? "bg-foreground/[0.12] text-foreground"
              : "bg-foreground/[0.04] text-muted-foreground/50"
          }`}
        >
          {n}
        </span>
      )}
      <span
        className={`text-[11px] font-medium ${
          state === "done"
            ? "text-emerald-400"
            : state === "active"
            ? "text-foreground"
            : "text-muted-foreground/40"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function WorkflowArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted-foreground/20">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

// ── Step badge ─────────────────────────────────────────────────────────────

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  if (done) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <CheckIcon size={10} />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-bold tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

// ── Metric tile ────────────────────────────────────────────────────────────

function ScheduleTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[12px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function BulkCsvSection({
  mintAddress,
  onMintAddressChange: _onMintAddressChange,
  mintDecimals,
  mintLoading: _mintLoading,
  campaignId: _campaignId,
  onCampaignIdChange: _onCampaignIdChange,
  cancellable: _cancellable,
  onCancellableChange: _onCancellableChange,
  csvText,
  onCsvTextChange,
  onParse,
  csvTemplate,
  csvResult,
  prepared,
  vestingType = "cliff",
  tokenSymbol = "",
}: {
  mintAddress: string;
  onMintAddressChange: (value: string) => void;
  mintDecimals: number | null;
  mintLoading: boolean;
  campaignId: string;
  onCampaignIdChange: (value: string) => void;
  cancellable: boolean;
  onCancellableChange: (value: boolean) => void;
  csvText: string;
  onCsvTextChange: (value: string) => void;
  onParse: () => void;
  csvTemplate: string;
  csvResult: BulkCsvParseResult | null;
  prepared: PreparedBulkCampaign | null;
  vestingType?: VestingType;
  tokenSymbol?: string;
}) {
  const [exampleOpen, setExampleOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [uploadAttemptedWithoutToken, setUploadAttemptedWithoutToken] = useState(false);

  const hasToken = !!mintAddress;
  const hasContent = csvText.trim().length > 0;

  useEffect(() => {
    if (hasToken) setUploadAttemptedWithoutToken(false);
  }, [hasToken]);

  const hasResult = csvResult !== null;
  const isValid = hasResult && csvResult.issues.length === 0 && csvResult.rows.length > 0;

  // Schedule metrics from valid rows
  const scheduleMetrics = (() => {
    const rows = csvResult?.rows;
    if (!rows?.length) return null;
    let earliest = rows[0].startTime;
    let latest = rows[0].endTime;
    for (const r of rows) {
      if (r.startTime < earliest) earliest = r.startTime;
      if (r.endTime > latest) latest = r.endTime;
    }
    return { earliest, latest, duration: latest - earliest };
  })();

  // Release type label from prepared mix
  const releaseTypeLabel = (() => {
    if (!prepared) return null;
    const { cliff, linear, milestone } = prepared.releaseMix;
    if (cliff && !linear && !milestone) return "Cliff";
    if (!cliff && linear && !milestone) return "Linear";
    if (!cliff && !linear && milestone) return "Milestone";
    return "Mixed";
  })();

  const step1State = hasToken ? "done" : "active";
  const step2State = !hasToken ? "pending" : isValid ? "done" : "active";
  const step3State = !hasToken || !isValid ? "pending" : prepared ? "done" : "active";
  const step4State = prepared ? "active" : "pending";

  const vestingLabel =
    vestingType === "cliff" ? "Cliff" : vestingType === "linear" ? "Linear" : "Milestone";
  const columns = COLUMNS_BY_TYPE[vestingType];

  const sym = tokenSymbol || "";

  function handleDownload() {
    const blob = new Blob([csvTemplate], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vesting-${vestingType}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") onCsvTextChange(text);
    };
    reader.onerror = () => {};
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleUploadAttemptWithoutToken() {
    if (!hasToken) setUploadAttemptedWithoutToken(true);
  }

  return (
    <div className="space-y-3">
      {/* ── Workflow progress indicator ── */}
      <div className={`${CARD} px-5 py-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowStep n={1} label="Select Token" state={step1State} />
          <WorkflowArrow />
          <WorkflowStep n={2} label="Import CSV" state={step2State} />
          <WorkflowArrow />
          <WorkflowStep n={3} label="Review Allocations" state={step3State} />
          <WorkflowArrow />
          <WorkflowStep n={4} label="Create Campaign" state={step4State} />
        </div>
      </div>

      {/* ── Step 2: Download + Upload ── */}
      <div className={`${CARD} p-5 space-y-4`}>
        <div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <StepBadge n={2} done={isValid} />
              <div>
                <h3 className="text-[13px] font-semibold text-foreground">Import CSV</h3>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {!hasToken
                    ? "Select a token above, then upload your recipient list"
                    : hasContent
                    ? "File loaded — validate below before continuing"
                    : "Download the template, fill in your recipients, then upload"}
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-md border border-foreground/[0.08] bg-foreground/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {vestingLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg border border-foreground/[0.10] bg-foreground/[0.03] px-3.5 py-2 text-[12px] font-medium text-foreground transition hover:border-foreground/[0.18] hover:bg-foreground/[0.06]"
            >
              <DownloadIcon />
              Download {vestingType}-template.csv
            </button>
            <p className="text-[11px] text-muted-foreground">
              Auto-generated from today&apos;s date · Edit addresses before uploading
            </p>
          </div>
        </div>

        <div className="h-px bg-foreground/[0.05]" />

        {/* Upload zone */}
        {!hasToken ? (
          <div>
            <div
              role="button"
              tabIndex={0}
              onClick={handleUploadAttemptWithoutToken}
              onKeyDown={(e) => e.key === "Enter" && handleUploadAttemptWithoutToken()}
              className="flex cursor-not-allowed flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-foreground/[0.05] bg-foreground/[0.01] px-4 py-8 text-center select-none"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] text-muted-foreground/30">
                <LockIcon />
              </div>
              <div>
                <p className="text-[12px] font-medium text-muted-foreground/50">
                  Select a token first to import recipient allocations
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/30">
                  Select a token in General Details above
                </p>
              </div>
            </div>
            {uploadAttemptedWithoutToken && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-amber-400">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <p className="text-[12px] font-medium text-amber-400">
                  Select a token before importing CSV
                </p>
              </div>
            )}
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-foreground/[0.08] bg-foreground/[0.01] px-4 py-8 text-center transition hover:border-foreground/[0.16] hover:bg-foreground/[0.03]">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-foreground/[0.08] bg-foreground/[0.05] text-muted-foreground">
              <UploadCloudIcon />
            </div>
            <div>
              <p className="text-[13px] font-medium text-foreground">Drop your CSV file here</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                or click to browse &nbsp;·&nbsp; .csv files only
              </p>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-foreground/[0.05]" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            or paste directly
          </span>
          <div className="h-px flex-1 bg-foreground/[0.05]" />
        </div>

        <textarea
          rows={6}
          placeholder={
            !hasToken
              ? "Select a token first to enable CSV input…"
              : "Paste your CSV here…"
          }
          value={csvText}
          onChange={(e) => hasToken && onCsvTextChange(e.target.value)}
          disabled={!hasToken}
          className={`${INPUT} min-h-[130px] font-mono text-[11px] leading-5 ${
            !hasToken ? "cursor-not-allowed opacity-40" : ""
          }`}
          spellCheck={false}
        />
      </div>

      {/* ── Step 3: Review Allocations ── */}
      <div className={`${CARD} overflow-hidden`}>
        {/* Preview Example (collapsible) */}
        <button
          type="button"
          onClick={() => setExampleOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 p-5 text-left transition hover:bg-foreground/[0.01]"
        >
          <div className="flex items-start gap-2.5">
            <StepBadge n={3} done={!!prepared} />
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Review Allocations</h3>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {csvResult && csvResult.validRowCount > 0
                  ? `${csvResult.validRowCount} valid row${csvResult.validRowCount === 1 ? "" : "s"}${
                      csvResult.invalidRowCount > 0
                        ? `, ${csvResult.invalidRowCount} invalid`
                        : " — ready to import"
                    }`
                  : csvResult && csvResult.invalidRowCount > 0
                  ? `${csvResult.invalidRowCount} row${csvResult.invalidRowCount === 1 ? "" : "s"} with issues — fix errors and re-validate`
                  : `Preview the ${vestingLabel} template format and validate your CSV`}
              </p>
            </div>
          </div>
          <ChevronIcon open={exampleOpen} />
        </button>

        {exampleOpen && (
          <div className="border-t border-foreground/[0.06] px-5 pb-5 pt-4 space-y-4">
            <div className="overflow-hidden rounded-xl border border-foreground/[0.08]">
              <div className="flex items-center justify-between border-b border-foreground/[0.06] bg-foreground/[0.03] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {vestingLabel} template · auto-generated from today
                </p>
                <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                  .csv
                </span>
              </div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[10px] leading-5 text-muted-foreground">
                {csvTemplate}
              </pre>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setGlossaryOpen((v) => !v)}
                className="mb-2 flex w-full items-center justify-between text-left"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Column guide ({columns.length} columns)
                </p>
                <ChevronIcon open={glossaryOpen} />
              </button>
              {glossaryOpen && (
                <div className="space-y-2.5">
                  {columns.map((col) => {
                    const info = COLUMN_GLOSSARY[col];
                    if (!info) return null;
                    return (
                      <div key={col} className="flex items-start gap-3">
                        <code className="mt-0.5 shrink-0 rounded-md border border-foreground/[0.08] bg-foreground/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {col}
                        </code>
                        <div className="min-w-0">
                          <span className="text-[12px] font-medium text-foreground">
                            {info.label}
                          </span>
                          <span className="ml-1.5 text-[12px] text-muted-foreground">
                            — {info.desc}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Parse & Validate */}
        <div className={`p-5 space-y-4 ${exampleOpen ? "border-t border-foreground/[0.06]" : ""}`}>
          <button
            type="button"
            onClick={onParse}
            disabled={!hasToken || !hasContent}
            className="inline-flex items-center gap-2 rounded-xl bg-foreground/[0.06] px-4 py-2.5 text-[13px] font-medium text-foreground transition hover:bg-foreground/[0.10] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {!hasToken ? (
              <>
                <LockIcon />
                Select a token to validate
              </>
            ) : (
              "Validate CSV"
            )}
          </button>

          {/* Validation summary banner */}
          {csvResult && (
            <div
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                csvResult.issues.length === 0
                  ? "border-emerald-500/20 bg-emerald-500/[0.05]"
                  : "border-red-500/20 bg-red-500/[0.05]"
              }`}
            >
              <span
                className={`mt-0.5 shrink-0 ${
                  csvResult.issues.length === 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {csvResult.issues.length === 0 ? (
                  <CheckCircleIcon size={15} />
                ) : (
                  <XCircleIcon size={15} />
                )}
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {csvResult.validRowCount > 0 && (
                  <span className="text-[12px] font-semibold text-emerald-400">
                    {csvResult.validRowCount} valid row{csvResult.validRowCount === 1 ? "" : "s"}
                  </span>
                )}
                {csvResult.invalidRowCount > 0 && (
                  <span className="text-[12px] font-semibold text-red-400">
                    {csvResult.invalidRowCount} invalid row{csvResult.invalidRowCount === 1 ? "" : "s"}
                  </span>
                )}
                {csvResult.issues.length === 0 && csvResult.validRowCount > 0 && (
                  <span className="text-[11px] text-emerald-400/70">No errors found</span>
                )}
              </div>
            </div>
          )}

          {/* Issue details */}
          {csvResult?.issues.length ? (
            <div className="space-y-1.5 rounded-xl border border-red-500/15 bg-red-500/[0.04] p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-red-400/70">
                {csvResult.issues.length} issue{csvResult.issues.length === 1 ? "" : "s"} to fix
              </p>
              {csvResult.issues.map((issue, index) => (
                <p key={`${issue.rowNumber}-${index}`} className="text-[12px] leading-5 text-red-300">
                  <span className="font-medium text-red-400">{formatIssueLabel(issue.rowNumber)}:</span>{" "}
                  {issue.message}
                </p>
              ))}
            </div>
          ) : null}

          {/* Schedule summary — shown after valid parse */}
          {scheduleMetrics && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <CalendarIcon size={10} />
                Vesting Schedule
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ScheduleTile
                  label="Earliest Start"
                  value={formatUnixToDate(scheduleMetrics.earliest)}
                />
                <ScheduleTile
                  label="Latest End"
                  value={formatUnixToDate(scheduleMetrics.latest)}
                />
                <ScheduleTile
                  label="Duration"
                  value={formatDurationSeconds(scheduleMetrics.duration)}
                />
              </div>
            </div>
          )}

          {/* Preview table with token symbol + totals footer */}
          {csvResult?.rows && csvResult.rows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-foreground/[0.06]">
              <div className="flex items-center justify-between border-b border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Preview · {Math.min(5, csvResult.rows.length)} of {csvResult.rows.length} rows
                </p>
                {csvResult.rows.length > 5 && (
                  <p className="text-[10px] text-muted-foreground/60">
                    +{csvResult.rows.length - 5} more
                  </p>
                )}
              </div>
              <table className="w-full text-left text-[12px]">
                <thead className="bg-foreground/[0.01]">
                  <tr>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground">Wallet</th>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground">
                      Amount{sym ? ` (${sym})` : ""}
                    </th>
                    <th className="px-3 py-2.5 font-medium text-muted-foreground">Type</th>
                    {vestingType === "milestone" && (
                      <th className="px-3 py-2.5 font-medium text-muted-foreground">Milestone</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {csvResult.rows.slice(0, 5).map((row) => (
                    <tr key={row.rowNumber} className="border-t border-foreground/[0.05]">
                      <td className="px-3 py-2.5 font-mono text-foreground">
                        {row.beneficiary.slice(0, 4)}…{row.beneficiary.slice(-4)}
                      </td>
                      <td className="px-3 py-2.5 text-foreground">
                        {row.amountInput}
                        {sym && (
                          <span className="ml-1 text-[11px] text-muted-foreground">{sym}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {row.releaseType === 0 ? "Cliff" : row.releaseType === 1 ? "Linear" : "Milestone"}
                      </td>
                      {vestingType === "milestone" && (
                        <td className="px-3 py-2.5 text-muted-foreground">#{row.milestoneIdx}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {/* Totals footer */}
                {prepared && (
                  <tfoot>
                    <tr className="border-t-2 border-foreground/[0.08] bg-foreground/[0.03]">
                      <td className="px-3 py-2.5 text-[11px] font-semibold text-muted-foreground">
                        {prepared.leafCount} recipient{prepared.leafCount === 1 ? "" : "s"} total
                      </td>
                      <td
                        className="px-3 py-2.5 text-[12px] font-semibold text-foreground"
                        colSpan={vestingType === "milestone" ? 3 : 2}
                      >
                        {mintDecimals !== null
                          ? formatTokenAmount(prepared.totalSupply, mintDecimals)
                          : prepared.totalSupply}
                        {sym && (
                          <span className="ml-1 font-normal text-muted-foreground">{sym}</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Step 4: Campaign Summary (shown after valid parse) ── */}
      {prepared && (
        <div className={`${CARD} p-5 space-y-3`}>
          <div className="flex items-start gap-2.5">
            <StepBadge n={4} />
            <div>
              <h3 className="text-[13px] font-semibold text-foreground">Create Campaign</h3>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                Review the summary, then click &quot;Create &amp; Fund Campaign&quot; in the sidebar
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 space-y-3">
            <SummaryRow label="Recipients" value={String(prepared.leafCount)} />
            {sym && <SummaryRow label="Token" value={sym} />}
            <SummaryRow
              label="Total Supply"
              value={
                mintDecimals !== null
                  ? `${formatTokenAmount(prepared.totalSupply, mintDecimals)}${sym ? ` ${sym}` : ""}`
                  : prepared.totalSupply
              }
            />
            {releaseTypeLabel && (
              <SummaryRow label="Release Type" value={releaseTypeLabel} />
            )}
            {prepared.releaseMix.cliff > 0 && releaseTypeLabel !== "Cliff" && (
              <SummaryRow label="Cliff streams" value={String(prepared.releaseMix.cliff)} />
            )}
            {prepared.releaseMix.linear > 0 && releaseTypeLabel !== "Linear" && (
              <SummaryRow label="Linear streams" value={String(prepared.releaseMix.linear)} />
            )}
            {prepared.releaseMix.milestone > 0 && releaseTypeLabel !== "Milestone" && (
              <SummaryRow label="Milestone leaves" value={String(prepared.releaseMix.milestone)} />
            )}
            {scheduleMetrics && (
              <>
                <SummaryRow
                  label="Earliest Start"
                  value={formatUnixToDate(scheduleMetrics.earliest)}
                />
                <SummaryRow
                  label="Latest End"
                  value={formatUnixToDate(scheduleMetrics.latest)}
                />
                <SummaryRow
                  label="Duration"
                  value={formatDurationSeconds(scheduleMetrics.duration)}
                />
              </>
            )}
            <SummaryRow label="Merkle Root" value={`${prepared.merkleRoot.slice(0, 16)}…`} mono />
          </div>
        </div>
      )}
    </div>
  );
}
