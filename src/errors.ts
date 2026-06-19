export type ErrorCode =
  | "BAD_REQUEST"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_ERROR"
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
