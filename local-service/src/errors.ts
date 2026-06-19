export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  MACHINE_NOT_SUPPORTED: "MACHINE_NOT_SUPPORTED",
  APP_VERSION_UNSUPPORTED: "APP_VERSION_UNSUPPORTED",
  APP_VERSION_CHECK_FAILED: "APP_VERSION_CHECK_FAILED",
  MISSING_CONFIRM_SAVE: "MISSING_CONFIRM_SAVE",
  DRY_RUN_CONFIRM_CONFLICT: "DRY_RUN_CONFIRM_CONFLICT",
  APPIUM_SESSION_ERROR: "APPIUM_SESSION_ERROR",
  NAVIGATION_ERROR: "NAVIGATION_ERROR",
  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
  SLIDER_SET_FAILED: "SLIDER_SET_FAILED",
  SAVE_FAILED: "SAVE_FAILED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  QUEUE_FULL: "QUEUE_FULL",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ServiceError extends Error {
  constructor(
    public readonly code: ErrorCodeType,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function toSafeMessage(err: unknown): string {
  if (err instanceof ServiceError) return err.message;
  return "An internal error occurred";
}

export function toErrorCode(err: unknown): ErrorCodeType {
  if (err instanceof ServiceError) return err.code;
  return ErrorCode.INTERNAL_ERROR;
}

export function toStatusCode(err: unknown): number {
  if (err instanceof ServiceError) return err.statusCode;
  return 500;
}
