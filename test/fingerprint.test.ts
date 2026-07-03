import { describe, expect, it } from "vitest";
// @ts-expect-error fingerprint is a runtime ESM JS module.
import { normalizeFingerprintPart, recipeFingerprint } from "../src/fingerprint.js";

describe("normalizeFingerprintPart", () => {
  it("normalizes English spacing/case and Arabic alef/tatweel/ta marbuta", () => {
    expect(normalizeFingerprintPart("  BLUE   Bottle  ")).toBe("blue bottle");
    expect(normalizeFingerprintPart(" قــهوة آمنة ")).toBe("قهوه امنه");
  });
});

describe("recipeFingerprint", () => {
  const base = {
    roastery: "OPT",
    beanName: "Yemenia",
    brewMode: "cold",
    finalDrinkMl: 300,
    profile: "bright_funky",
    rulesVersion: "1.1.0",
  };

  it("separates retune revisions for the same bean and target", async () => {
    await expect(recipeFingerprint({ ...base, revision: 0 })).resolves.not.toBe(
      await recipeFingerprint({ ...base, revision: 1 }),
    );
  });

  it("separates engine versions for the same bean and target", async () => {
    await expect(recipeFingerprint({ ...base, engineVersion: "hybrid-1.1.0" })).resolves.not.toBe(
      await recipeFingerprint({ ...base, engineVersion: "hybrid-1.2.0" }),
    );
  });
});
