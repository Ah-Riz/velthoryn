"use client";

import type { BulkCsvParseResult, PreparedBulkCampaign } from "@/lib/campaign/bulk";
import {
  CARD,
  SECTION,
  INPUT,
  SectionHeader,
  SummaryRow,
  formatIssueLabel,
  formatTokenAmount,
} from "./shared";

export function BulkCsvSection({
  mintAddress: _mintAddress,
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
  vestingType?: "cliff" | "linear" | "milestone";
}) {
  const previewRows = csvResult?.rows.slice(0, 5) ?? [];

  return (
    <div className="space-y-5">
      <div className={`${CARD} space-y-4 p-5`}>
        <SectionHeader title={vestingType === "milestone" ? "Milestone Campaign CSV" : "Recipients CSV"} caption={
          vestingType === "cliff"
            ? "Columns: beneficiary, amount, releaseType (Cliff), startTime, cliffTime, endTime (= cliffTime), milestoneIdx (0)"
            : vestingType === "linear"
            ? "Columns: beneficiary, amount, releaseType (Linear), startTime, cliffTime (optional), endTime, milestoneIdx (0)"
            : "Each row defines one beneficiary milestone leaf. Columns: beneficiary, amount, releaseType (Milestone), startTime, cliffTime (unlock), endTime (= cliffTime), milestoneIdx (0-255)"
        } />

        {/* Download template */}
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([csvTemplate], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `template-${vestingType}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#8b92a5] transition hover:border-white/[0.16] hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Download {vestingType} CSV template
        </button>

        {/* File upload */}
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] px-4 py-6 text-[13px] text-[#8b92a5] transition hover:border-white/[0.2] hover:bg-white/[0.04]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          <span>{vestingType === "milestone" ? "Drop milestone CSV here or click to upload" : "Drop CSV file here or click to upload"}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                const text = ev.target?.result;
                if (typeof text === "string") onCsvTextChange(text);
              };
              reader.onerror = () => { /* ignore read errors */ };
              reader.readAsText(file);
              e.target.value = "";
            }}
          />
        </label>

        <textarea
          rows={6}
          placeholder={csvTemplate}
          value={csvText}
          onChange={(e) => onCsvTextChange(e.target.value)}
          className={`${INPUT} min-h-[140px] font-mono text-[11px]`}
        />
        <button
          type="button"
          onClick={onParse}
          className="rounded-xl bg-white/[0.06] px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-white/[0.1]"
        >
          Parse & Validate
        </button>

        {csvResult?.issues.length ? (
          <div className="space-y-1">
            {csvResult.issues.map((issue, index) => (
              <p key={`${issue.rowNumber}-${index}`} className="text-[12px] text-red-400">
                {formatIssueLabel(issue.rowNumber)}: {issue.message}
              </p>
            ))}
          </div>
        ) : null}

        {previewRows.length ? (
          <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-white/[0.03] text-[#8b92a5]">
                <tr>
                  <th className="px-3 py-2 font-medium">{vestingType === "milestone" ? "Beneficiary" : "Recipient"}</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  {vestingType === "milestone" && (
                    <th className="px-3 py-2 font-medium">Milestone #</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-white/[0.06] text-white">
                    <td className="px-3 py-2 font-mono">{row.beneficiary}</td>
                    <td className="px-3 py-2">{row.amountInput}</td>
                    <td className="px-3 py-2">{row.releaseType === 0 ? "Cliff" : row.releaseType === 1 ? "Linear" : "Milestone"}</td>
                    {vestingType === "milestone" && (
                      <td className="px-3 py-2">{row.milestoneIdx}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {prepared ? (
          <div className={`${SECTION} space-y-3`}>
            <SummaryRow label="Recipients" value={String(prepared.leafCount)} />
            <SummaryRow
              label="Total Supply"
              value={mintDecimals !== null ? formatTokenAmount(prepared.totalSupply, mintDecimals) : prepared.totalSupply}
            />
            <SummaryRow label="Cliff streams" value={String(prepared.releaseMix.cliff)} />
            <SummaryRow label="Linear streams" value={String(prepared.releaseMix.linear)} />
            {prepared.releaseMix.milestone > 0 && (
              <SummaryRow label="Milestone leaves" value={String(prepared.releaseMix.milestone)} />
            )}
            <SummaryRow label="Merkle Root" value={`${prepared.merkleRoot.slice(0, 16)}...`} mono />
          </div>
        ) : null}
      </div>
    </div>
  );
}
