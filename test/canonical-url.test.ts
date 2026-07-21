import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANONICAL_ORIGIN,
  LEGACY_PUBLIC_HOST,
  redirectLegacyPage,
} from "../src/canonical-url.js";

describe("legacy public URL redirect", () => {
  it("permanently redirects recipe paths and query strings to the branded origin", () => {
    const response = redirectLegacyPage(
      new Request(`https://${LEGACY_PUBLIC_HOST}/recipes/abc-123?from=history`),
    );

    expect(response?.status).toBe(308);
    expect(response?.headers.get("Location")).toBe(
      `${DEFAULT_CANONICAL_ORIGIN}/recipes/abc-123?from=history`,
    );
  });

  it.each(["/", "/login", "/history", "/recipes", "/admin", "/admin/users/1/recipes"])(
    "redirects the browser-facing page %s",
    (path) => {
      expect(redirectLegacyPage(new Request(`https://${LEGACY_PUBLIC_HOST}${path}`))?.status).toBe(
        308,
      );
    },
  );

  it.each(["/health", "/api/auth/me", "/api/bridge/jobs/next", "/assets/app.js", "/sw.js"])(
    "keeps the legacy non-page endpoint %s live",
    (path) => {
      expect(redirectLegacyPage(new Request(`https://${LEGACY_PUBLIC_HOST}${path}`))).toBeNull();
    },
  );

  it("does not redirect requests already using the branded origin", () => {
    expect(redirectLegacyPage(new Request(`${DEFAULT_CANONICAL_ORIGIN}/history`))).toBeNull();
  });

  it("does not redirect mutating methods", () => {
    expect(
      redirectLegacyPage(new Request(`https://${LEGACY_PUBLIC_HOST}/history`, { method: "POST" })),
    ).toBeNull();
  });

  it("fails closed to the branded default when the configured origin is unsafe", () => {
    const response = redirectLegacyPage(
      new Request(`https://${LEGACY_PUBLIC_HOST}/history`),
      "https://evil.example/path",
    );
    expect(response?.headers.get("Location")).toBe(`${DEFAULT_CANONICAL_ORIGIN}/history`);
  });
});
