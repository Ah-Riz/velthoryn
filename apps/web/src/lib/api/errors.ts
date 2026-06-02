import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { getRequestId } from "@/lib/api/request-id";
import { jsonResponse } from "@/lib/api/json-response";
import { logRequest } from "@/lib/api/logger";
import { API_VERSION } from "@/lib/api/version";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  // Clawback-specific error codes
  | "NOT_CANCELLABLE"
  | "ALREADY_CANCELLED"
  | "FULLY_VESTED"
  | "GRACE_PERIOD_ACTIVE"
  | "NOT_CANCELLED"
  | "NOT_SINGLE_STREAM"
  | "MILESTONE_ALREADY_RELEASED"
  | "NOT_ELIGIBLE_FOR_INSTANT_REFUND";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class AuthError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}

export class RateLimitError extends AppError {
  constructor(public readonly retryAfter: number) {
    super("Too many requests", 429, "RATE_LIMITED");
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Payload too large") {
    super(message, 413, "PAYLOAD_TOO_LARGE");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, 409, "CONFLICT");
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error") {
    super(message, 500, "INTERNAL_ERROR");
  }
}

export function errorResponse(
  error: AppError,
  requestId: string,
): NextResponse {
  const body: Record<string, unknown> = {
    error: error.message,
    code: error.code,
    requestId,
  };
  if (error.details !== undefined) {
    body.details = error.details;
  }

  const headers: Record<string, string> = { "X-API-Version": API_VERSION };
  if (error instanceof RateLimitError) {
    headers["Retry-After"] = String(error.retryAfter);
  }
  if (error instanceof AuthError) {
    headers["WWW-Authenticate"] = "Solana";
  }

  return jsonResponse(body, { status: error.statusCode, headers });
}

export type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<any> },
) => Promise<NextResponse>;

export function errorHandler(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    const requestId = getRequestId(request);
    const startedAt = Date.now();

    try {
      const response = await handler(request, context);
      logRequest({
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      // X-API-Version is set here for all successful responses; error responses
      // get it in errorResponse() below.
      if (!headers.has("X-API-Version")) {
        headers.set("X-API-Version", API_VERSION);
      }
      return new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      if (error instanceof AppError) {
        logRequest({
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          status: error.statusCode,
          durationMs,
          level: "warn",
          message: error.message,
          code: error.code,
        });
        return errorResponse(error, requestId);
      }

      if (error instanceof ZodError) {
        const validation = new ValidationError("Validation failed", error.issues);
        logRequest({
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          status: 400,
          durationMs,
          level: "warn",
          message: validation.message,
          code: validation.code,
        });
        return errorResponse(validation, requestId);
      }

      logRequest({
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: 500,
        durationMs,
        level: "error",
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });

      return errorResponse(new InternalError(), requestId);
    }
  };
}
