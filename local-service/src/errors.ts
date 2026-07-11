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
  SHARE_LINK_FAILED: "SHARE_LINK_FAILED",
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
  if (err instanceof ServiceError) {
    switch (err.code) {
      case ErrorCode.SLIDER_SET_FAILED:
        return "xBloom did not accept one of the recipe settings. Please retry once; if it repeats, create a new recipe with slightly different settings.";
      case ErrorCode.NAVIGATION_ERROR:
      case ErrorCode.APPIUM_SESSION_ERROR:
        return "The Mac bridge could not control the xBloom app. Please confirm the emulator is open, logged in, and on a stable connection.";
      case ErrorCode.SAVE_FAILED:
        return "xBloom could not open the final save screen. No recipe was created. Please retry once.";
      case ErrorCode.SHARE_LINK_FAILED:
        // These messages are fixed, user-facing strings produced by automation.ts.
        return err.message;
      case ErrorCode.APP_VERSION_UNSUPPORTED:
      case ErrorCode.APP_VERSION_CHECK_FAILED:
        return "The Mac bridge needs an xBloom app update or maintenance before it can continue.";
      case ErrorCode.QUEUE_FULL:
        return "The Mac bridge is busy with other recipes. Please wait and retry.";
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.MACHINE_NOT_SUPPORTED:
      case ErrorCode.MISSING_CONFIRM_SAVE:
      case ErrorCode.DRY_RUN_CONFIRM_CONFLICT:
      case ErrorCode.ELEMENT_NOT_FOUND:
      case ErrorCode.IDEMPOTENCY_CONFLICT:
      case ErrorCode.INTERNAL_ERROR:
        return "The Mac bridge could not process this recipe. Please retry; if it repeats, create a new recipe.";
      default:
        return "The Mac bridge encountered an unexpected error. Please retry.";
    }
  }
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

/** Bounded technical detail for the Mac-only logs. Never return this text to
 * the Worker or website. */
export function toLocalDiagnostic(err: unknown): string {
  if (!(err instanceof Error)) return "Non-Error throw";
  return err.message.replace(/[\r\n]+/g, " ").slice(0, 500);
}
