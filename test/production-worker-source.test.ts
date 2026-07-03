import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production Worker source safeguards", () => {
  const workerSource = readFileSync("index.js", "utf8");

  it("reclassifies the confirmed bean before fingerprinting instead of reusing pending suggestion", () => {
    expect(workerSource).not.toContain("parseRecipeProfile(void 0, pending.suggested_profile)");
    expect(workerSource).toContain("await chooseRecipeProfile(confirmedBean, env)");
    expect(workerSource.indexOf("const confirmedBean =")).toBeLessThan(
      workerSource.indexOf("const fingerprint = await recipeFingerprint"),
    );
  });

  it("persists and reuses sticky bean profile classifications", () => {
    expect(workerSource).toContain("function beanProfileCacheKey");
    expect(workerSource).toContain("SELECT * FROM bean_profile_cache WHERE normalized_key = ?");
    expect(workerSource).toContain("await findBeanProfileCache(env.DB, storeName, beanName)");
    expect(workerSource).toContain("await rememberBeanProfile(env.DB, storeName, beanName");
  });

  it("does not allow environment drift back to the legacy free-form recipe engine", () => {
    expect(workerSource).toContain('RECIPE_ENGINE must be "table"');
  });

  it("uses non-colliding confirmation name limits", () => {
    expect(workerSource).toContain("var CONFIRMED_STORE_NAME_MAX_CHARS = 40;");
    expect(workerSource).toContain("var CONFIRMED_BEAN_NAME_MAX_CHARS = 60;");
  });
});
