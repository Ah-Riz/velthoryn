"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

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
}

let nextId = 1;
function genId() { return `r-${nextId++}-${Date.now()}`; }

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

export function AllocationEditor({ initialRecipients, loading, onSubmit, canRotate }: Props) {
  const [rows, setRows] = useState<RecipientRow[]>(
    initialRecipients.length > 0 ? initialRecipients : [emptyRow()],
  );
  const [synced, setSynced] = useState(false);

  // Sync rows when initialRecipients arrive async
  if (!synced && initialRecipients.length > 0 && rows[0]?.beneficiary === "") {
    setRows(initialRecipients);
    setSynced(true);
  }

  function updateRow(id: string, field: keyof RecipientRow, value: string | number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.length > 1 ? prev.filter((r) => r.id !== id) : prev);
  }

  function addRow() {
    const last = rows[rows.length - 1];
    setRows((prev) => [...prev, emptyRow({
      releaseType: last?.releaseType,
      startTime: last?.startTime,
      cliffTime: last?.cliffTime,
      endTime: last?.endTime,
    })]);
  }

  const valid = rows.every((r) => r.beneficiary.length >= 32 && r.amount && Number(r.amount) > 0);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-foreground/[0.06]">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-foreground/[0.06] bg-foreground/[0.02] text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5">Recipient Wallet</th>
              <th className="px-3 py-2.5 w-28">Amount</th>
              <th className="px-3 py-2.5 w-24">Type</th>
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-foreground/[0.04]">
                <td className="px-2 py-1.5">
                  <input
                    value={row.beneficiary}
                    onChange={(e) => updateRow(row.id, "beneficiary", e.target.value)}
                    placeholder="Solana wallet address"
                    className="w-full rounded-lg border border-foreground/[0.08] bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/20"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={row.amount}
                    onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                    placeholder="0.00"
                    type="number"
                    step="any"
                    className="w-full rounded-lg border border-foreground/[0.08] bg-muted px-2.5 py-1.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/20"
                  />
                </td>
                <td className="px-2 py-1.5">
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
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length <= 1}
                    className="text-muted-foreground transition hover:text-red-700 dark:text-red-400 disabled:opacity-30"
                    title="Remove"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={addRow}
          className="h-auto rounded-lg border border-foreground/[0.08] px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        >
          + Add Recipient
        </Button>
        <span className="text-[11px] text-muted-foreground">{rows.length} recipient{rows.length !== 1 ? "s" : ""}</span>
      </div>

      {canRotate && (
        <Button
          type="button"
          onClick={() => onSubmit(rows)}
          disabled={loading || !valid}
          className="w-full h-auto rounded-xl bg-violet-700 dark:bg-violet-600 px-4 py-3 text-[13px] font-semibold text-foreground hover:bg-violet-600 dark:hover:bg-violet-500"
        >
          {loading ? "Publishing Update..." : "Update Allocations"}
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
