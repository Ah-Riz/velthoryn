"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  /** beneficiary → raw integer token amount (as string) from the DB */
  claimedAmounts?: Record<string, string>;
  mintDecimals?: number;
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

// ─── row-level validation ────────────────────────────────────────────────────

function computeRowErrors(
  rows: RecipientRow[],
  claimedAmounts: Record<string, string>,
  decimals: number,
): Record<string, string> {
  // Sum the new decimal allocation per beneficiary (handles multi-leaf milestone campaigns)
  const newTotalByBenef = new Map<string, number>();
  for (const r of rows) {
    if (!r.beneficiary) continue;
    newTotalByBenef.set(r.beneficiary, (newTotalByBenef.get(r.beneficiary) ?? 0) + (Number(r.amount) || 0));
  }

  const errors: Record<string, string> = {};
  for (const r of rows) {
    if (!r.beneficiary) continue;
    const raw = claimedAmounts[r.beneficiary];
    if (!isPositiveRaw(raw)) continue;
    const claimedDecimal = Number(raw) / 10 ** decimals;
    if ((newTotalByBenef.get(r.beneficiary) ?? 0) < claimedDecimal) {
      errors[r.id] = `Cannot go below ${rawToDecimal(raw, decimals)} already claimed`;
    }
  }
  return errors;
}

// ─── component ───────────────────────────────────────────────────────────────

export function AllocationEditor({
  initialRecipients,
  loading,
  onSubmit,
  canRotate,
  claimedAmounts = {},
  mintDecimals = 9,
}: Props) {
  const [rows, setRows] = useState<RecipientRow[]>(
    initialRecipients.length > 0 ? initialRecipients : [emptyRow()],
  );
  const [synced, setSynced] = useState(false);
  const [originalRows, setOriginalRows] = useState<RecipientRow[]>([]);
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set());
  const pendingFocusId = useRef<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Sync when initialRecipients arrive async
  if (!synced && initialRecipients.length > 0 && rows[0]?.beneficiary === "") {
    setRows(initialRecipients);
    setOriginalRows(initialRecipients);
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
  }

  const rowErrors = computeRowErrors(rows, claimedAmounts, mintDecimals);
  const diff = computeDiff(originalRows, rows);
  const netDelta = diff.addedDelta - diff.removedDelta + diff.updatedDelta;
  const hasErrors = Object.keys(rowErrors).length > 0;
  const valid = !hasErrors && rows.every((r) => r.beneficiary.length >= 32 && r.amount && Number(r.amount) > 0);

  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground">
          {rows.length} recipient{rows.length !== 1 ? "s" : ""}
        </p>
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

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-xl border border-foreground/[0.06]">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-foreground/[0.06] bg-foreground/[0.02] text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5">Recipient Wallet</th>
              <th className="px-3 py-2.5 w-36">Amount</th>
              <th className="px-3 py-2.5 w-24">Type</th>
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
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

                  {/* Vesting type */}
                  <td className="px-2 py-2 align-top">
                    <select
                      value={row.releaseType}
                      onChange={(e) => updateRow(row.id, "releaseType", Number(e.target.value))}
                      className="w-full rounded-lg border border-foreground/[0.08] bg-muted px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-foreground/20"
                    >
                      <option value={0}>Cliff</option>
                      <option value={1}>Linear</option>
                      <option value={2}>Milestone</option>
                    </select>
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

      {canRotate && (
        <Button
          type="button"
          onClick={() => onSubmit(rows)}
          disabled={loading || !valid}
          className="w-full h-auto rounded-xl bg-violet-700 dark:bg-violet-600 px-4 py-3 text-[13px] font-semibold text-foreground hover:bg-violet-600 dark:hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? "Publishing Update…" : "Update Allocations"}
        </Button>
      )}

      {!canRotate && (
        <p className="text-[12px] text-amber-700 dark:text-amber-400">
          Only the cancel authority can update allocations.
        </p>
      )}
    </div>
  );
}
