import type { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { bulkRecipientSchema } from "@/lib/api/validators";
import { getRequestId } from "@/lib/api/request-id";
import { logger } from "@/lib/api/logger";
import { parseCsvRows, normalizeCsvHeader } from "@/lib/campaign/csv";
import { MAX_CLIFF_LINEAR_LEAVES_PER_BENEFICIARY } from "@/lib/campaign/limits";

const REQUIRED_HEADERS = [
  "beneficiary",
  "amount",
  "releaseType",
  "startTime",
  "cliffTime",
  "endTime",
  "milestoneIdx",
] as const;

type CsvError = {
  row: number;
  field: string;
  message: string;
};

type ValidRecipient = {
  beneficiary: string;
  amount: string;
  releaseType: number;
  startTime: string;
  cliffTime: string;
  endTime: string;
  milestoneIdx: number;
  row: number;
};

function parseCsvText(text: string): {
  recipients: ValidRecipient[];
  totalRows: number;
  validRows: number;
  errors: CsvError[];
} {
  const allRows = parseCsvRows(text);

  if (allRows.length === 0) {
    throw new ValidationError("CSV file is empty");
  }

  const headerLine = allRows[0].map(normalizeCsvHeader);
  for (const required of REQUIRED_HEADERS) {
    if (!headerLine.includes(required)) {
      throw new ValidationError(
        `CSV header is missing or malformed. Required columns: ${REQUIRED_HEADERS.join(", ")}`,
      );
    }
  }

  const colIndex: Record<string, number> = {};
  for (const col of REQUIRED_HEADERS) {
    colIndex[col] = headerLine.indexOf(col);
  }

  const dataRows = allRows.slice(1);
  const totalRows = dataRows.length;
  const recipients: ValidRecipient[] = [];
  const errors: CsvError[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2; // 1-indexed, header is row 1
    const cells = dataRows[i].map((c) => c.trim());

    const raw = {
      beneficiary: cells[colIndex.beneficiary] ?? "",
      amount: cells[colIndex.amount] ?? "",
      releaseType: Number(cells[colIndex.releaseType] ?? ""),
      startTime: cells[colIndex.startTime] ?? "",
      cliffTime: cells[colIndex.cliffTime] ?? "",
      endTime: cells[colIndex.endTime] ?? "",
      milestoneIdx: Number(cells[colIndex.milestoneIdx] ?? "0"),
    };

    const result = bulkRecipientSchema.safeParse(raw);
    if (result.success) {
      recipients.push({ ...result.data, row: rowNum });
    } else {
      for (const issue of result.error.issues) {
        const field = issue.path.length > 0 ? String(issue.path[0]) : "schedule";
        errors.push({ row: rowNum, field, message: issue.message });
      }
    }
  }

  // Per-leaf cap (ADR-003): the on-chain ClaimRecord tracks up to
  // PER_LEAF_CAP=8 cliff/linear leaves per beneficiary. Allow up to that cap;
  // reject rows beyond it so the CSV doesn't import only to fail with
  // PerLeafCapExceeded at claim time. Milestone rows (release_type 2) use a
  // bitmap and don't consume ledger slots, so they're exempt.
  const cliffLinearCount = new Map<string, number>();
  const duplicateRows = new Set<number>();
  for (const recipient of recipients) {
    if (recipient.releaseType !== 2) {
      const count = (cliffLinearCount.get(recipient.beneficiary) ?? 0) + 1;
      cliffLinearCount.set(recipient.beneficiary, count);
      if (count > MAX_CLIFF_LINEAR_LEAVES_PER_BENEFICIARY) {
        duplicateRows.add(recipient.row);
        errors.push({
          row: recipient.row,
          field: "beneficiary",
          message:
            `beneficiary ${recipient.beneficiary} already has ${MAX_CLIFF_LINEAR_LEAVES_PER_BENEFICIARY} cliff/linear entries ` +
            `(the on-chain per-leaf ledger cap). Move this leaf to a separate campaign.`,
        });
      }
    }
  }

  const validRecipients = recipients.filter((r) => !duplicateRows.has(r.row));

  return {
    recipients: validRecipients,
    totalRows,
    validRows: validRecipients.length,
    errors,
  };
}

async function postImportHandler(request: NextRequest) {
  const requestId = getRequestId(request);

  logger.info({
    requestId,
    message: "[POST /api/campaigns/import] Request received",
  });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ValidationError("Request must be multipart/form-data");
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    throw new ValidationError("Missing 'file' field in form data");
  }

  const text = await (file as Blob).text();

  const result = parseCsvText(text);

  if (result.validRows === 0) {
    throw new ValidationError("No valid recipients found in CSV", result.errors);
  }

  return jsonResponse(result);
}

export const POST = withRoute(
  {
    auth: true,
    rateLimit: { requests: 5, window: 60 },
    bodyLimit: "import",
  },
  postImportHandler,
);
