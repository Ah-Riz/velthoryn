import { PublicKey } from "@solana/web3.js";
import {
  buildTree,
  type VestingLeaf,
} from "@/lib/merkle/builder";
import type { CampaignIndexPayload } from "@/lib/stream/persist";
import {
  validateAmountWithDecimals,
  validateSchedule,
} from "@/lib/validation/stream-form";

export const BULK_CSV_HEADERS = [
  "beneficiary",
  "amount",
  "releaseType",
  "startTime",
  "cliffTime",
  "endTime",
  "milestoneIdx",
] as const;

type BulkHeader = (typeof BULK_CSV_HEADERS)[number];

export type BulkCsvIssue = {
  rowNumber: number | "header";
  message: string;
};

export type BulkCsvRow = {
  rowNumber: number;
  beneficiary: string;
  amountInput: string;
  amountRaw: string;
  releaseType: 0 | 1 | 2;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
};

export type BulkCsvParseResult = {
  rows: BulkCsvRow[];
  issues: BulkCsvIssue[];
};

export type PreparedBulkCampaign = {
  leafCount: number;
  merkleRoot: string;
  totalSupply: string;
  releaseMix: {
    cliff: number;
    linear: number;
    milestone: number;
  };
  leaves: Array<{
    leafIndex: number;
    beneficiary: string;
    amount: string;
    releaseType: 0 | 1 | 2;
    startTime: string;
    cliffTime: string;
    endTime: string;
    milestoneIdx: number;
    proof: number[][];
  }>;
};

export function toRawAmount(value: string, decimals: number): string {
  const parts = value.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const raw = whole + frac;
  return raw.replace(/^0+/, "") || "0";
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function parseReleaseType(value: string): 0 | 1 | 2 | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "cliff") return 0;
  if (normalized === "1" || normalized === "linear") return 1;
  if (normalized === "2" || normalized === "milestone") return 2;
  return null;
}

function parseTimestamp(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;

  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const normalized = trimmed.includes("T")
    ? trimmed
    : trimmed.replace(" ", "T");
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return Number.NaN;
  return Math.floor(ms / 1000);
}

function issue(rowNumber: number | "header", message: string): BulkCsvIssue {
  return { rowNumber, message };
}

function validateBeneficiary(value: string): string | null {
  if (!value.trim()) return "Enter a beneficiary wallet.";
  try {
    new PublicKey(value.trim());
    return null;
  } catch {
    return "Enter a valid Solana wallet address.";
  }
}

function humanizeAmountError(message: string): string {
  switch (message) {
    case "Required.":
      return "Enter an amount.";
    case "Must be a positive integer (no decimals).":
      return "Use a whole number only.";
    case "Must be a positive number.":
      return "Enter a valid number.";
    case "Must be greater than zero.":
      return "Amount must be greater than 0.";
    case "Invalid number.":
      return "Invalid amount.";
    default:
      if (message.startsWith("Supports up to ")) {
        return `Too many decimal places. ${message}`;
      }
      return message;
  }
}

function humanizeScheduleError(message: string): string {
  switch (message) {
    case "All dates are required.":
      return "Enter the start, cliff/unlock, and end times.";
    case "Cliff time must be on or after start time.":
      return "Cliff/unlock time cannot be earlier than the start time.";
    case "End time must be on or after cliff time.":
      return "End time cannot be earlier than the cliff/unlock time.";
    case "Cliff must be at least 60 seconds after start (Solana clock tolerance).":
      return "Leave at least 60 seconds between the start time and cliff/unlock time.";
    case "For cliff vesting, end time should equal cliff time.":
      return "For cliff vesting, end time must match the cliff time.";
    case "For milestone vesting, end time should equal unlock time.":
      return "For milestone vesting, end time must match the unlock time.";
    default:
      return message;
  }
}

export function parseBulkCsv(
  text: string,
  mintDecimals: number | null,
): BulkCsvParseResult {
  const rows = parseCsvText(text);
  if (rows.length === 0) {
    return {
      rows: [],
      issues: [issue("header", "Your CSV is empty.")],
    };
  }

  const headerRow = rows[0].map(normalizeHeader);
  const headerMap = new Map<string, number>();
  headerRow.forEach((header, index) => {
    headerMap.set(header, index);
  });

  const issues: BulkCsvIssue[] = [];
  const requiredHeaders: BulkHeader[] = [
    "beneficiary",
    "amount",
    "releaseType",
    "startTime",
    "cliffTime",
  ];

  for (const header of requiredHeaders) {
    if (!headerMap.has(normalizeHeader(header))) {
      issues.push(issue("header", `Missing required column: ${header}.`));
    }
  }

  if (issues.length > 0) {
    return { rows: [], issues };
  }

  const parsedRows: BulkCsvRow[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const source = rows[rowIndex];
    const rowNumber = rowIndex + 1;
    const getCell = (header: string) =>
      source[headerMap.get(normalizeHeader(header)) ?? -1] ?? "";

    const beneficiary = getCell("beneficiary").trim();
    const amountInput = getCell("amount").trim();
    const releaseTypeValue = getCell("releaseType");
    const startTimeRaw = getCell("startTime");
    const cliffTimeRaw = getCell("cliffTime");
    const endTimeRaw = getCell("endTime") || cliffTimeRaw;
    const milestoneIdxRaw = (getCell("milestoneIdx") || "0").trim();

    const rowIssues: string[] = [];

    const beneficiaryError = validateBeneficiary(beneficiary);
    if (beneficiaryError) rowIssues.push(beneficiaryError);

    const amountError = validateAmountWithDecimals(amountInput, mintDecimals);
    if (amountError) rowIssues.push(humanizeAmountError(amountError));

    const releaseType = parseReleaseType(releaseTypeValue);
    if (releaseType === null) {
      rowIssues.push("Unknown vesting type. Use Cliff, Linear, Milestone, or 0, 1, 2.");
    }

    const startTime = parseTimestamp(startTimeRaw);
    const cliffTime = parseTimestamp(cliffTimeRaw);
    const endTime = parseTimestamp(endTimeRaw);
    const scheduleError = validateSchedule(
      startTime,
      cliffTime,
      endTime,
      releaseType ?? 1,
    );
    if (scheduleError) rowIssues.push(humanizeScheduleError(scheduleError));

    let milestoneIdx = 0;
    if (milestoneIdxRaw) {
      if (!/^\d+$/.test(milestoneIdxRaw)) {
        rowIssues.push("Milestone index must be a whole number.");
      } else {
        milestoneIdx = Number(milestoneIdxRaw);
        if (milestoneIdx > 255) rowIssues.push("Milestone index must be between 0 and 255.");
      }
    }
    if (releaseType !== 2 && milestoneIdx !== 0) {
      rowIssues.push("For cliff and linear rows, milestone index must be 0.");
    }
    if (releaseType === 2 && milestoneIdx === 0 && !milestoneIdxRaw) {
      rowIssues.push("Enter a milestone index for this milestone row.");
    }

    if (rowIssues.length > 0) {
      for (const message of rowIssues) {
        issues.push(issue(rowNumber, message));
      }
      continue;
    }

    const amountRaw =
      mintDecimals !== null ? toRawAmount(amountInput, mintDecimals) : amountInput;

    parsedRows.push({
      rowNumber,
      beneficiary,
      amountInput,
      amountRaw,
      releaseType: releaseType as 0 | 1 | 2,
      startTime,
      cliffTime,
      endTime,
      milestoneIdx,
    });
  }

  if (parsedRows.length === 0 && issues.length === 0) {
    issues.push(issue("header", "Add at least one data row to the CSV."));
  }

  // Duplicate rules:
  // - Cliff / Linear: one beneficiary may appear only once per campaign.
  // - Milestone: one beneficiary may appear multiple times, but each
  //   beneficiary + milestoneIdx pair must be unique.
  const nonMilestoneBeneficiaryCounts = new Map<string, number[]>();
  const milestoneKeys = new Map<string, number[]>();

  for (const row of parsedRows) {
    if (row.releaseType === 2) {
      const key = `${row.beneficiary}:${row.milestoneIdx}`;
      const existing = milestoneKeys.get(key) ?? [];
      existing.push(row.rowNumber);
      milestoneKeys.set(key, existing);
      continue;
    }

    const existing = nonMilestoneBeneficiaryCounts.get(row.beneficiary) ?? [];
    existing.push(row.rowNumber);
    nonMilestoneBeneficiaryCounts.set(row.beneficiary, existing);
  }

  for (const [addr, rows] of nonMilestoneBeneficiaryCounts) {
    if (rows.length > 1) {
      issues.push(
        issue(
          rows[1],
          `Wallet ${addr.slice(0, 8)}… appears more than once. For cliff and linear campaigns, each wallet can only appear once.`,
        ),
      );
    }
  }

  for (const [key, rows] of milestoneKeys) {
    if (rows.length > 1) {
      const [addr, milestoneIdx] = key.split(":");
      issues.push(
        issue(
          rows[1],
          `Wallet ${addr.slice(0, 8)}… already uses milestone #${milestoneIdx}. For the same wallet, each milestone needs a different index.`,
        ),
      );
    }
  }

  return { rows: issues.length > 0 ? [] : parsedRows, issues };
}

export function prepareBulkCampaign(rows: BulkCsvRow[]): PreparedBulkCampaign {
  const leavesForTree: VestingLeaf[] = rows.map((row, index) => ({
    leafIndex: index,
    beneficiary: row.beneficiary,
    amount: BigInt(row.amountRaw),
    releaseType: row.releaseType,
    startTs: BigInt(row.startTime),
    cliffTs: BigInt(row.cliffTime),
    endTs: BigInt(row.endTime),
    milestoneIdx: row.milestoneIdx,
  }));

  const tree = buildTree(leavesForTree);

  let totalSupply = 0n;
  let cliffCount = 0;
  let linearCount = 0;
  let milestoneCount = 0;

  const leaves = leavesForTree.map((leaf, index) => {
    totalSupply += leaf.amount;
    if (leaf.releaseType === 0) cliffCount += 1;
    if (leaf.releaseType === 1) linearCount += 1;
    if (leaf.releaseType === 2) milestoneCount += 1;

    return {
      leafIndex: leaf.leafIndex,
      beneficiary: leaf.beneficiary,
      amount: leaf.amount.toString(),
      releaseType: leaf.releaseType as 0 | 1 | 2,
      startTime: leaf.startTs.toString(),
      cliffTime: leaf.cliffTs.toString(),
      endTime: leaf.endTs.toString(),
      milestoneIdx: leaf.milestoneIdx,
      proof: tree.proof(index).map((buffer) => Array.from(buffer)),
    };
  });

  return {
    leafCount: leaves.length,
    merkleRoot: tree.rootHex,
    totalSupply: totalSupply.toString(),
    releaseMix: {
      cliff: cliffCount,
      linear: linearCount,
      milestone: milestoneCount,
    },
    leaves,
  };
}

export function buildCreateCampaignIndexPayload(params: {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  cancellable: boolean;
  cancelAuthority: string | null;
  pauseAuthority: string | null;
  createdAt?: number;
  prepared: PreparedBulkCampaign;
}): CampaignIndexPayload {
  return {
    treeAddress: params.treeAddress,
    creator: params.creator,
    mint: params.mint,
    campaignId: params.campaignId,
    merkleRoot: params.prepared.merkleRoot,
    leafCount: params.prepared.leafCount,
    totalSupply: params.prepared.totalSupply,
    cancellable: params.cancellable,
    cancelAuthority: params.cancelAuthority,
    pauseAuthority: params.pauseAuthority,
    createdAt: params.createdAt ?? Math.floor(Date.now() / 1000),
    leaves: params.prepared.leaves,
  };
}

export function bulkCsvTemplate(): string {
  return [
    BULK_CSV_HEADERS.join(","),
    "11111111111111111111111111111111,1000,Cliff,1735689600,1735776000,1735776000,0",
    "11111111111111111111111111111112,2500,Linear,1735689600,1735776000,1738368000,0",
    "11111111111111111111111111111113,500,Milestone,1735689600,1735862400,1735862400,1",
  ].join("\n");
}

export function bulkCsvTemplateForType(type: "cliff" | "linear" | "milestone"): string {
  const header = BULK_CSV_HEADERS.join(",");
  if (type === "cliff") {
    return [
      "beneficiary,amount,releaseType,startTime,cliffTime",
      "RECIPIENT_ADDRESS_1,1000,Cliff,2025-06-01 09:00,2025-07-01 09:00",
      "RECIPIENT_ADDRESS_2,2000,Cliff,2025-06-01 09:00,2025-08-01 09:00",
    ].join("\n");
  }
  if (type === "linear") {
    return [
      header,
      "RECIPIENT_ADDRESS_1,1000,Linear,2025-06-01 09:00,2025-06-01 09:00,2025-12-01 09:00,0",
      "RECIPIENT_ADDRESS_2,2500,Linear,2025-06-01 09:00,2025-07-01 09:00,2026-06-01 09:00,0",
    ].join("\n");
  }
  // milestone
  return [
    header,
    "RECIPIENT_ADDRESS_1,500,Milestone,2025-06-01 09:00,2025-09-01 09:00,2025-09-01 09:00,0",
    "RECIPIENT_ADDRESS_2,500,Milestone,2025-06-01 09:00,2025-12-01 09:00,2025-12-01 09:00,1",
    "RECIPIENT_ADDRESS_3,500,Milestone,2025-06-01 09:00,2026-03-01 09:00,2026-03-01 09:00,2",
  ].join("\n");
}
