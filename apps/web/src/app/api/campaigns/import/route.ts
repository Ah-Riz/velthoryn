import type { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { bulkRecipientSchema } from "@/lib/api/validators";
import { getRequestId } from "@/lib/api/request-id";
import { logger } from "@/lib/api/logger";

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
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    throw new ValidationError("CSV file is empty");
  }

  const headerLine = lines[0].split(",").map((h) => h.trim());
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

  const dataLines = lines.slice(1);
  const totalRows = dataLines.length;
  const recipients: ValidRecipient[] = [];
  const errors: CsvError[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const rowNum = i + 2; // 1-indexed, header is row 1
    const cells = dataLines[i].split(",").map((c) => c.trim());

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

  return { recipients, totalRows, validRows: recipients.length, errors };
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
