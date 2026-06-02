import pino from "pino";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

type LogLevel = "debug" | "info" | "warn" | "error";
type LogArgs = Parameters<typeof pinoLogger.info>;

function safeLog(level: LogLevel, args: LogArgs): void {
  try {
    pinoLogger[level](...args);
  } catch {
    // Logging must never change API behavior.
  }
}

export const logger = {
  debug: (...args: LogArgs) => safeLog("debug", args),
  info: (...args: LogArgs) => safeLog("info", args),
  warn: (...args: LogArgs) => safeLog("warn", args),
  error: (...args: LogArgs) => safeLog("error", args),
};

export interface RequestLogFields {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  level?: "info" | "warn" | "error";
  message?: string;
  code?: string;
  stack?: string;
}

export function logRequest(fields: RequestLogFields): void {
  const {
    level = fields.status >= 500 ? "error" : fields.status >= 400 ? "warn" : "info",
    ...rest
  } = fields;

  const payload = {
    timestamp: new Date().toISOString(),
    ...rest,
  };

  if (level === "error") {
    logger.error(payload);
  } else if (level === "warn") {
    logger.warn(payload);
  } else {
    logger.info(payload);
  }
}
