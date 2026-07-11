import { describe, expect, it } from "vitest";
import { ErrorCode, ServiceError, toLocalDiagnostic, toSafeMessage } from "../src/errors.js";

describe("toSafeMessage", () => {
  it("does not expose low-level slider diagnostics to website users", () => {
    const message = toSafeMessage(
      new ServiceError(
        ErrorCode.SLIDER_SET_FAILED,
        "Slider pour2_pause stuck at 2 after 5 retries; target was 0",
        500,
      ),
    );

    expect(message).toContain("xBloom did not accept one of the recipe settings");
    expect(message).not.toContain("Slider");
    expect(message).not.toContain("pour2_pause");
  });

  it("keeps actionable share-link failures visible", () => {
    const message = toSafeMessage(
      new ServiceError(
        ErrorCode.SHARE_LINK_FAILED,
        "xBloom did not create a share link. Please try again.",
        503,
      ),
    );

    expect(message).toBe("xBloom did not create a share link. Please try again.");
  });

  it("does not expose internal recipe validation details", () => {
    const message = toSafeMessage(
      new ServiceError(
        ErrorCode.VALIDATION_ERROR,
        "totalVolumeMl (180) must equal doseG×ratio (15×13=195)",
        422,
      ),
    );

    expect(message).toContain("could not process this recipe");
    expect(message).not.toContain("totalVolumeMl");
    expect(message).not.toContain("15×13");
  });

  it("turns app-version diagnostics into a maintenance message", () => {
    const message = toSafeMessage(
      new ServiceError(
        ErrorCode.APP_VERSION_UNSUPPORTED,
        "Expected 2.2.2 (2002033), received 2.2.3 (2003033)",
        409,
      ),
    );

    expect(message).toContain("update or maintenance");
    expect(message).not.toContain("2002033");
  });

  it("turns navigation errors into an emulator-check message", () => {
    const message = toSafeMessage(
      new ServiceError(ErrorCode.NAVIGATION_ERROR, "Could not reach Recipes tab", 500),
    );
    expect(message).toContain("xBloom app");
  });

  it("explains save-screen failures without exposing Webdriver details", () => {
    const message = toSafeMessage(
      new ServiceError(
        ErrorCode.SAVE_FAILED,
        "element (Save recipe) still not existing after 10000ms",
        503,
      ),
    );
    expect(message).toContain("No recipe was created");
    expect(message).not.toContain("element");
    expect(message).not.toContain("10000ms");
  });

  it("returns a generic fallback for non-ServiceError throws", () => {
    const message = toSafeMessage(new Error("something internal"));
    expect(message).toBe("An internal error occurred");
  });
});

describe("toLocalDiagnostic", () => {
  it("keeps bounded technical detail in local logs without multiline injection", () => {
    const diagnostic = toLocalDiagnostic(new Error(`selector failed\n${"x".repeat(600)}`));
    expect(diagnostic).not.toContain("\n");
    expect(diagnostic).toHaveLength(500);
  });
});
