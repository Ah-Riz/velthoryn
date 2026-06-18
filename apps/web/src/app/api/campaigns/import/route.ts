import type { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { bulkRecipientSchema } from "@/lib/api/validators";
import { getRequestId } from "@/lib/api/request-id";
import { logger } from "@/lib/api/logger";
import { parseCsvRows, normalizeCsvHeader } from "@/lib/campaign/csv";

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

  // Known Issue #29: reject multiple cliff/linear leaves per beneficiary.
  const cliffLinearSeen = new Map<string, number>();
  const duplicateRows = new Set<number>();
  for (const recipient of recipients) {
    if (recipient.releaseType !== 2) {
      const prevRow = cliffLinearSeen.get(recipient.beneficiary);
      if (prevRow !== undefined) {
        duplicateRows.add(recipient.row);
        errors.push({
          row: recipient.row,
          field: "beneficiary",
          message:
            `Known Issue #29: beneficiary ${recipient.beneficiary} already has a cliff/linear entry at row ${prevRow}`,
        });
      } else {
        cliffLinearSeen.set(recipient.beneficiary, recipient.row);
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
