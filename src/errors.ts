export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "CONFLICT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_ERROR"
  | "TOO_MANY_REQUESTS"
  | "TURNSTILE_FAILED"
  | "UPSTREAM_MALFORMED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ClientError extends AppError {
  constructor(message: string) {
    super("BAD_REQUEST", message, 400);
    this.name = "ClientError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(message: string) {
    super("METHOD_NOT_ALLOWED", message, 405);
    this.name = "MethodNotAllowedError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class UnsupportedMediaError extends AppError {
  constructor(message: string) {
    super("UNSUPPORTED_MEDIA_TYPE", message, 415);
    this.name = "UnsupportedMediaError";
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super("PAYLOAD_TOO_LARGE", message, 413);
    this.name = "PayloadTooLargeError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 422);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string) {
    super("TOO_MANY_REQUESTS", message, 429);
    this.name = "RateLimitError";
  }
}

export class TurnstileError extends AppError {
  constructor(message: string) {
    super("TURNSTILE_FAILED", message, 403);
    this.name = "TurnstileError";
  }
}

export class UpstreamMalformedError extends AppError {
  constructor(message: string) {
    super("UPSTREAM_MALFORMED", message, 502);
    this.name = "UpstreamMalformedError";
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super("UPSTREAM_ERROR", message, 502);
    this.name = "UpstreamError";
  }
}

export class InternalError extends AppError {
  constructor(message: string) {
    super("INTERNAL_ERROR", message, 500);
    this.name = "InternalError";
  }
}
