import { describe, expect, it } from "vitest";
// @ts-expect-error fingerprint is a runtime ESM JS module.
import { normalizeFingerprintPart } from "../src/fingerprint.js";

describe("normalizeFingerprintPart", () => {
  it("normalizes English spacing/case and Arabic alef/tatweel/ta marbuta", () => {
    expect(normalizeFingerprintPart("  BLUE   Bottle  ")).toBe("blue bottle");
    expect(normalizeFingerprintPart(" قــهوة آمنة ")).toBe("قهوه امنه");
  });
});
