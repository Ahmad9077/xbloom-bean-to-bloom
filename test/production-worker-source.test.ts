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
    expect(workerSource).toContain("await safeFindBeanProfileCache(");
    expect(workerSource).toContain("await safeRememberBeanProfile(");
    expect(workerSource).toContain("ON CONFLICT(normalized_key) DO UPDATE SET");
    expect(workerSource).toContain(
      "WHERE excluded.confidence > COALESCE(bean_profile_cache.confidence, -1)",
    );
  });

  it("reclassifies and updates sticky profile when confirmed roast differs from cache", () => {
    expect(workerSource).toContain("cachedClassification.roastLevel !== confirmedBean.roastLevel");
    expect(workerSource).toContain('reasons: ["confirmed roast level changed"]');
    expect(workerSource).toContain("profileCacheRefresh");
  });

  it("keeps bean profile cache fail-open for recipe confirmation", () => {
    expect(workerSource).toContain("async function safeFindBeanProfileCache");
    expect(workerSource).toContain("async function safeRememberBeanProfile");
    expect(workerSource).toContain('event: "bean_profile_cache_read_failed"');
    expect(workerSource).toContain('event: "bean_profile_cache_write_failed"');
    expect(workerSource).not.toContain("await findBeanProfileCache(env.DB, storeName, beanName)");
    expect(workerSource).not.toContain("await rememberBeanProfile(env.DB, storeName, beanName");
  });

  it("has an admin-only endpoint to reset one sticky bean profile", () => {
    expect(workerSource).toContain("async function handleDeleteBeanProfileCache");
    expect(workerSource).toContain("await requireAdmin(request, env)");
    expect(workerSource).toContain("/api/admin/bean-profile-cache");
    expect(workerSource).toContain("DELETE FROM bean_profile_cache WHERE normalized_key = ?");
  });

  it("removes the discontinued WhatsApp recipe service while preserving Mac bridge routes", () => {
    expect(workerSource).not.toContain("/api/bridge/recipes/from-bean");
    expect(workerSource).not.toContain("/api/bridge/recipes/from-upload");
    expect(workerSource).not.toContain("/api/bridge/whatsapp-users/link");
    expect(workerSource).not.toContain("handleBridgeRecipeFromBean");
    expect(workerSource).not.toContain("handleBridgeRecipeFromUpload");
    expect(workerSource).not.toContain("handleBridgeLinkWhatsAppUser");
    expect(workerSource).not.toContain("parseWhatsAppSenderId");
    expect(workerSource).not.toContain("resolveWhatsAppRecipeOwner");
    expect(workerSource).not.toContain("WHATSAPP_RECIPE_TOKEN_HASH");
    expect(workerSource).not.toContain('"whatsapp"');
    expect(workerSource).not.toContain("requireServiceTokenAuth");
    expect(workerSource).toContain("/api/bridge/jobs/next");
    expect(workerSource).toContain("/api/bridge/jobs/");
  });

  it("does not serve the SPA shell for unknown API routes", () => {
    expect(workerSource).toContain('pathname.startsWith("/api/") || pathname.startsWith("/v1/")');
    expect(workerSource).toContain('throw new NotFoundError("Route not found")');
  });

  it("does not accept manual brew profile overrides from confirmation requests", () => {
    expect(workerSource).not.toContain("manualProfileProvided");
    expect(workerSource).not.toContain("manual profile override");
    expect(workerSource).not.toContain("parseRecipeProfile(input.profile");
    expect(workerSource).toContain('Object.prototype.hasOwnProperty.call(input, "profile")');
    expect(workerSource).toContain(
      "Brew profile is chosen automatically from confirmed bean details",
    );
  });

  it("requires unknown roast level to be corrected before recommendation", () => {
    expect(workerSource).toContain('if (bean.roastLevel === "unknown") missing.push("roastLevel")');
    expect(workerSource).toContain('Z=rl!=="unknown"');
    expect(workerSource).toContain('rl==="unknown"&&i.jsx("p"');
  });

  it("does not allow environment drift back to the legacy free-form recipe engine", () => {
    expect(workerSource).toContain('RECIPE_ENGINE must be "table"');
  });

  it("uses non-colliding confirmation name limits", () => {
    expect(workerSource).toContain("var CONFIRMED_STORE_NAME_MAX_CHARS = 40;");
    expect(workerSource).toContain("var CONFIRMED_BEAN_NAME_MAX_CHARS = 60;");
  });
});
