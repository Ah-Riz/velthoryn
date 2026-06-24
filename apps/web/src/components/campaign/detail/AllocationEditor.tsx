"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toRawAmount } from "@/lib/campaign/bulk";

export interface RecipientRow {
  id: string;
  beneficiary: string;
  amount: string;
  releaseType: number;
  startTime: string;
  cliffTime: string;
  endTime: string;
  milestoneIdx: number;
}

interface Props {
  initialRecipients: RecipientRow[];
  loading: boolean;
  onSubmit: (recipients: RecipientRow[]) => void;
  canRotate: boolean;
  lockedReason?: string | null;
  /** beneficiary → raw integer token amount (as string) from the DB */
  claimedAmounts?: Record<string, string>;
  mintDecimals?: number;
  /** raw integer total_supply (as string) — immutable after campaign creation */
  totalSupplyRaw?: string;
}

let nextId = 1;
function genId() { return `new-${nextId++}-${Date.now()}`; }

export function emptyRow(defaults?: Partial<RecipientRow>): RecipientRow {
  return {
    id: genId(),
    beneficiary: "",
    amount: "",
    releaseType: defaults?.releaseType ?? 0,
    startTime: defaults?.startTime ?? "",
    cliffTime: defaults?.cliffTime ?? "",
    endTime: defaults?.endTime ?? "",
    milestoneIdx: defaults?.milestoneIdx ?? 0,
  };
}

// ─── pure helpers ───────────────────────────────────────────────────────────

function rawToDecimal(raw: string, decimals: number): string {
  try {
    const n = BigInt(raw);
    if (n === 0n) return "0";
    if (decimals === 0) return n.toLocaleString();
    const div = 10n ** BigInt(decimals);
    const whole = n / div;
    const frac = n % div;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
  } catch {
    return raw;
  }
}

function isPositiveRaw(raw: string | undefined): boolean {
  if (!raw) return false;
  try { return BigInt(raw) > 0n; } catch { return false; }
}

function fmtDelta(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
  return n > 0 ? `+${abs}` : `−${abs}`; // U+2212 proper minus
}

// ─── diff ────────────────────────────────────────────────────────────────────

interface Diff {
  added: number;
  updated: number;
  removed: number;
  hasChanges: boolean;
  addedDelta: number;
  updatedDelta: number;
  removedDelta: number;
}

function computeDiff(original: RecipientRow[], current: RecipientRow[]): Diff {
  const origMap = new Map(original.filter((r) => r.beneficiary).map((r) => [r.beneficiary, r]));
  const currMap = new Map(current.filter((r) => r.beneficiary).map((r) => [r.beneficiary, r]));

  let added = 0, updated = 0, removed = 0;
  let addedDelta = 0, updatedDelta = 0, removedDelta = 0;

  for (const [b, curr] of currMap) {
    const orig = origMap.get(b);
    if (!orig) {
      added++;
      addedDelta += Number(curr.amount) || 0;
    } else if (
      orig.amount !== curr.amount ||
      orig.releaseType !== curr.releaseType ||
      orig.startTime !== curr.startTime ||
      orig.cliffTime !== curr.cliffTime ||
      orig.endTime !== curr.endTime ||
      orig.milestoneIdx !== curr.milestoneIdx
    ) {
      updated++;
      updatedDelta += (Number(curr.amount) || 0) - (Number(orig.amount) || 0);
    }
  }
  for (const [b, orig] of origMap) {
    if (!currMap.has(b)) {
      removed++;
      removedDelta += Number(orig.amount) || 0;
    }
  }

  return { added, updated, removed, hasChanges: added + updated + removed > 0, addedDelta, updatedDelta, removedDelta };
}

function fmtAmount(decimal: number): string {
  return decimal.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

// ─── row-level validation ────────────────────────────────────────────────────

function computeRowErrors(
  rows: RecipientRow[],
  claimedAmounts: Record<string, string>,
  decimals: number,
): Record<string, string> {
  // Sum the new raw allocation per beneficiary using BigInt (handles multi-leaf milestone campaigns)
  const newTotalByBenef = new Map<string, bigint>();
  for (const r of rows) {
    if (!r.beneficiary) continue;
    try {
      const rowRaw = BigInt(toRawAmount(r.amount || "0", decimals));
      newTotalByBenef.set(r.beneficiary, (newTotalByBenef.get(r.beneficiary) ?? 0n) + rowRaw);
    } catch { /* skip rows with invalid amount strings */ }
  }

  const errors: Record<string, string> = {};
  for (const r of rows) {
    if (!r.beneficiary) continue;
    const raw = claimedAmounts[r.beneficiary];
    if (!isPositiveRaw(raw)) continue;
    const claimedBig = BigInt(raw);
    if ((newTotalByBenef.get(r.beneficiary) ?? 0n) < claimedBig) {
      errors[r.id] = `Cannot go below ${rawToDecimal(raw, decimals)} already claimed`;
    }
  }
  return errors;
}

function computeRemovalErrors(
  originalRows: RecipientRow[],
  currentRows: RecipientRow[],
  claimedAmounts: Record<string, string>,
  decimals: number,
): string[] {
  const currentBenef = new Set(currentRows.filter((r) => r.beneficiary).map((r) => r.beneficiary));
  return originalRows
    .filter((r) => r.beneficiary && !currentBenef.has(r.beneficiary) && isPositiveRaw(claimedAmounts[r.beneficiary]))
    .map((r) => {
      const short = `${r.beneficiary.slice(0, 4)}…${r.beneficiary.slice(-4)}`;
      return `Cannot remove ${short} — they have already claimed ${rawToDecimal(claimedAmounts[r.beneficiary], decimals)} tokens.`;
    });
}

// ─── release type display config ────────────────────────────────────────────

const RELEASE_TYPE_CONFIG: Record<number, { label: string; badge: string }> = {
  0: { label: "Cliff",     badge: "text-sky-700 bg-sky-500/10 dark:text-sky-400" },
  1: { label: "Linear",    badge: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-400" },
  2: { label: "Milestone", badge: "text-amber-700 bg-amber-500/10 dark:text-amber-400" },
};

// ─── component ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export function AllocationEditor({
  initialRecipients,
  loading,
  onSubmit,
  canRotate,
  lockedReason,
  claimedAmounts = {},
  mintDecimals = 9,
  totalSupplyRaw,
}: Props) {
  const [rows, setRows] = useState<RecipientRow[]>(
    initialRecipients.length > 0 ? initialRecipients : [emptyRow()],
  );
  const [synced, setSynced] = useState(false);
  const [originalRows, setOriginalRows] = useState<RecipientRow[]>([]);
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set());
  // Rows that arrived from the DB (non-empty beneficiary at sync time) — releaseType locked for these
  const [existingRowIds, setExistingRowIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const pendingFocusId = useRef<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Sync when initialRecipients arrive async
  if (!synced && initialRecipients.length > 0 && rows[0]?.beneficiary === "") {
    setRows(initialRecipients);
    setOriginalRows(initialRecipients);
    setExistingRowIds(new Set(initialRecipients.filter((r) => r.beneficiary).map((r) => r.id)));
    setSynced(true);
  }

  // Auto-focus beneficiary field of a freshly added row
  useEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    const el = inputRefs.current.get(id);
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      pendingFocusId.current = null;
    }
  });

  function updateRow(id: string, field: keyof RecipientRow, value: string | number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.length > 1 ? prev.filter((r) => r.id !== id) : prev);
    setNewRowIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  function addRow() {
    const last = rows[rows.length - 1];
    const newRow = emptyRow({ releaseType: last?.releaseType, startTime: last?.startTime, cliffTime: last?.cliffTime, endTime: last?.endTime });
    setRows((prev) => [...prev, newRow]);
    setNewRowIds((prev) => new Set([...prev, newRow.id]));
    pendingFocusId.current = newRow.id;
    // Jump to last page (where the new row lands) and clear search
    setSearchQuery("");
    setCurrentPage(Math.floor(rows.length / PAGE_SIZE));
  }

  // Search + pagination (display only — rows state stays full)
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.beneficiary.toLowerCase().includes(q));
  }, [rows, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pagedRows = filteredRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setCurrentPage(0);
  }

  const rowErrors = computeRowErrors(rows, claimedAmounts, mintDecimals);
  const removalErrors = computeRemovalErrors(originalRows, rows, claimedAmounts, mintDecimals);
  const diff = computeDiff(originalRows, rows);
  const netDelta = diff.addedDelta - diff.removedDelta + diff.updatedDelta;

  // Budget check — BigInt path determines overBudget (on-chain gate)
  const supplyRawBig = totalSupplyRaw != null ? BigInt(totalSupplyRaw) : null;
  const sumRaw = rows.reduce((acc, r) => {
    try { return acc + BigInt(toRawAmount(r.amount || "0", mintDecimals)); } catch { return acc; }
  }, 0n);
  const overBudget = supplyRawBig != null && sumRaw > supplyRawBig;

  // Float path — display only (progress bar width, decimal label)
  const sumDecimal = rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
  const supplyDecimal = supplyRawBig != null
    ? Number(supplyRawBig / 10n ** BigInt(mintDecimals))
    : null;
  const budgetPct = supplyDecimal ? Math.min((sumDecimal / supplyDecimal) * 100, 100) : 0;

  const hasErrors = Object.keys(rowErrors).length > 0 || overBudget || removalErrors.length > 0;
  const valid = !hasErrors && rows.every((r) => r.beneficiary.length >= 32 && r.amount && Number(r.amount) > 0);

  return (
    <div className="space-y-4">

      {/* ── Lock state header ── */}
      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ${
        lockedReason
          ? "border border-amber-500/20 bg-amber-500/[0.08] text-amber-700 dark:text-amber-400"
          : "border border-green-500/20 bg-green-500/[0.08] text-green-700 dark:text-green-400"
      }`}>
        {lockedReason ? (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            {lockedReason}
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 019.9-1"/>
            </svg>
            Editable
          </>
        )}
      </div>

      {/* ── Budget bar ── */}
      {supplyDecimal != null && (
        <div className={cn(
          "rounded-xl border px-4 py-3",
          overBudget
            ? "border-red-500/30 bg-red-500/[0.05]"
            : "border-emerald-500/20 bg-emerald-500/[0.04]",
        )}>
          <div className="flex items-center justify-between gap-3">
            <span className={cn(
              "text-[12px] font-medium",
              overBudget ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
            )}>
              Total allocated
            </span>
            <span className={cn(
              "text-[12px] font-semibold tabular-nums",
              overBudget ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
            )}>
              {fmtAmount(sumDecimal)} / {fmtAmount(supplyDecimal)}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
            <div
              className={cn("h-full rounded-full transition-all duration-150", overBudget ? "bg-red-500" : "bg-emerald-500")}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          {overBudget && (
            <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
              Total allocation exceeds campaign supply. Root rotation cannot expand the budget.
            </p>
          )}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <p className="shrink-0 text-[12px] text-muted-foreground">
            {searchQuery.trim()
              ? `${filteredRows.length} of ${rows.length} recipient${rows.length !== 1 ? "s" : ""}`
              : `${rows.length} recipient${rows.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <svg
              width="12" height="12" viewBox="0 0 16 16" fill="none"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search wallet…"
              className="h-7 w-48 rounded-xl border border-foreground/[0.08] bg-muted pl-7 pr-2.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3.5 py-1.5 text-[12px] font-medium text-violet-700 transition hover:bg-violet-500/20 dark:text-violet-400"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add Recipient
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-xl border border-foreground/[0.06]">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-foreground/[0.06] bg-foreground/[0.02] text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5">
                Recipient Wallet
                {rows.length > PAGE_SIZE && (
                  <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground/60">
                    ({safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredRows.length)} shown)
                  </span>
                )}
              </th>
              <th className="px-3 py-2.5 w-36">Amount</th>
              <th className="px-3 py-2.5 w-24">Type</th>
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 && searchQuery.trim() && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                  No recipients match &quot;{searchQuery}&quot;
                </td>
              </tr>
            )}
            {pagedRows.map((row) => {
              const isNew = newRowIds.has(row.id);
              const claimedRaw = claimedAmounts[row.beneficiary];
              const hasClaims = isPositiveRaw(claimedRaw);
              const claimedDisplay = hasClaims ? rawToDecimal(claimedRaw, mintDecimals) : null;
              const rowError = rowErrors[row.id];

              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-foreground/[0.04] transition-colors",
                    isNew && !rowError && "bg-violet-500/[0.04]",
                    rowError && "bg-red-500/[0.025]",
                  )}
                >
                  {/* Wallet */}
                  <td className={cn(
                    "px-2 py-2 align-top",
                    isNew && !rowError && "border-l-2 border-l-violet-500/50 pl-2.5",
                    rowError && "border-l-2 border-l-red-500/50 pl-2.5",
                  )}>
                    <input
                      ref={(el) => { if (el) inputRefs.current.set(row.id, el); else inputRefs.current.delete(row.id); }}
                      value={row.beneficiary}
                      onChange={(e) => updateRow(row.id, "beneficiary", e.target.value)}
                      placeholder="Solana wallet address"
                      className="w-full rounded-lg border border-foreground/[0.08] bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/20"
                    />
                  </td>

                  {/* Amount + claimed display + error */}
                  <td className="px-2 py-2 align-top">
                    <input
                      value={row.amount}
                      onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                      placeholder="0.00"
                      type="number"
                      step="any"
                      className={cn(
                        "w-full rounded-lg border border-foreground/[0.08] bg-muted px-2.5 py-1.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/20",
                        rowError && "border-red-500/40 focus:border-red-500/50",
                      )}
                    />
                    {/* Show claimed amount as a floor hint, or error if violated */}
                    {claimedDisplay && !rowError && (
                      <p className="mt-1 px-0.5 text-[10px] text-muted-foreground">
                        floor: {claimedDisplay} claimed
                      </p>
                    )}
                    {rowError && (
                      <p className="mt-1 px-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                        ⚠ {rowError}
                      </p>
                    )}
                  </td>

                  {/* Vesting type — locked badge for DB rows, editable select for new rows */}
                  <td className="px-2 py-2 align-top">
                    {existingRowIds.has(row.id) ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn(
                            "inline-flex w-full cursor-default items-center justify-center rounded-lg px-2 py-1.5 text-[11px] font-medium",
                            RELEASE_TYPE_CONFIG[row.releaseType]?.badge ?? "text-muted-foreground bg-foreground/[0.06]",
                          )}>
                            {RELEASE_TYPE_CONFIG[row.releaseType]?.label ?? "Unknown"}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[220px] text-center">
                          <p className="text-[11px] leading-5">
                            Release type is locked for existing recipients — changing it would silently corrupt the vesting schedule. Remove this row and add a new one to change the type.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <select
                        value={row.releaseType}
                        onChange={(e) => updateRow(row.id, "releaseType", Number(e.target.value))}
                        className="w-full rounded-lg border border-foreground/[0.08] bg-muted px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-foreground/20"
                      >
                        <option value={0}>Cliff</option>
                        <option value={1}>Linear</option>
                        <option value={2}>Milestone</option>
                      </select>
                    )}
                  </td>

                  {/* Remove */}
                  <td className="px-2 py-2 align-top text-center">
                    {hasClaims ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {/* span wrapper required — button[disabled] swallows pointer events needed for tooltip */}
                          <span className="inline-flex cursor-not-allowed text-muted-foreground/30 select-none">✕</span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-[200px] text-center">
                          <p className="text-[11px] leading-5">
                            {claimedDisplay} already claimed — recipient cannot be removed
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length <= 1}
                        className="text-muted-foreground transition hover:text-red-700 dark:hover:text-red-400 disabled:opacity-30"
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-foreground/20 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M8 1L3 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Prev
          </button>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            Page {safePage + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-foreground/20 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M4 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── Bottom ghost add-row button ── */}
      <button
        type="button"
        onClick={addRow}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/[0.10] py-2 text-[12px] text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Add another recipient
      </button>

      {/* ── Changes summary ── */}
      {diff.hasChanges && (
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3.5">
          <p className="mb-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Pending Changes</p>
          <div className="space-y-2">

            {diff.added > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[12px] text-emerald-700 dark:text-emerald-400">
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-bold leading-none">
                    +{diff.added}
                  </span>
                  added
                </span>
                <span className="text-[11px] tabular-nums text-emerald-700/80 dark:text-emerald-400/80">
                  {fmtDelta(diff.addedDelta)}
                </span>
              </div>
            )}

            {diff.updated > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[12px] text-amber-700 dark:text-amber-400">
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold leading-none">
                    ~{diff.updated}
                  </span>
                  updated
                </span>
                <span className={cn(
                  "text-[11px] tabular-nums",
                  diff.updatedDelta >= 0 ? "text-emerald-700/80 dark:text-emerald-400/80" : "text-red-600/80 dark:text-red-400/80",
                )}>
                  {fmtDelta(diff.updatedDelta)}
                </span>
              </div>
            )}

            {diff.removed > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[12px] text-red-700 dark:text-red-400">
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500/15 px-1.5 text-[10px] font-bold leading-none">
                    −{diff.removed}
                  </span>
                  removed
                </span>
                <span className="text-[11px] tabular-nums text-red-600/80 dark:text-red-400/80">
                  {fmtDelta(-diff.removedDelta)}
                </span>
              </div>
            )}

            {/* Net row — only when more than one type of change, or when there's a non-zero delta */}
            {(diff.added + diff.updated + diff.removed > 1 || netDelta !== 0) && (
              <div className="flex items-center justify-between gap-3 border-t border-foreground/[0.06] pt-2.5">
                <span className="text-[11px] text-muted-foreground">Net allocation</span>
                <span className={cn(
                  "text-[12px] font-semibold tabular-nums",
                  netDelta > 0 ? "text-emerald-700 dark:text-emerald-400"
                    : netDelta < 0 ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground",
                )}>
                  {fmtDelta(netDelta)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Removal errors ── */}
      {removalErrors.length > 0 && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 space-y-1.5">
          {removalErrors.map((err, i) => (
            <p key={i} className="text-[12px] font-medium text-red-600 dark:text-red-400">
              ⚠ {err}
            </p>
          ))}
        </div>
      )}

      {canRotate && !lockedReason && (
        <Button
          type="button"
          onClick={() => onSubmit(rows)}
          disabled={loading || !valid}
          className="w-full h-auto rounded-xl bg-violet-700 dark:bg-violet-600 px-4 py-3 text-[13px] font-semibold text-foreground hover:bg-violet-600 dark:hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "Publishing Update…" : "Update Allocations"}
        </Button>
      )}

      {(!canRotate || lockedReason) && (
        <p className="text-[12px] text-amber-700 dark:text-amber-400">
          {lockedReason ?? "Only the cancel authority can update allocations."}
        </p>
      )}
    </div>
  );
}
