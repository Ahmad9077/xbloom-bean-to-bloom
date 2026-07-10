import { describe, expect, it } from "vitest";
import { normalizePauseSecForApp, normalizeRecipeNameForApp } from "../src/automation.js";

describe("normalizePauseSecForApp", () => {
  it("maps legacy 0 and 1 second pauses to the live app minimum", () => {
    expect(normalizePauseSecForApp(0)).toBe(2);
    expect(normalizePauseSecForApp(1)).toBe(2);
  });

  it("preserves supported pause values", () => {
    expect(normalizePauseSecForApp(2)).toBe(2);
    expect(normalizePauseSecForApp(35)).toBe(35);
    expect(normalizePauseSecForApp(59)).toBe(59);
  });
});

describe("normalizeRecipeNameForApp", () => {
  it("preserves names that fit xBloom's limit", () => {
    expect(normalizeRecipeNameForApp("admin – OPT / Arabica")).toBe("admin – OPT / Arabica");
  });

  it("uses the same 30-character name that xBloom saves", () => {
    expect(normalizeRecipeNameForApp("admin – Qayel Ali / Tipica / Bourbon")).toBe(
      "admin – Qayel Ali / Tipica / B",
    );
  });

  it("does not split Unicode surrogate pairs", () => {
    const name = `${"a".repeat(29)}☕tail`;
    expect(Array.from(normalizeRecipeNameForApp(name))).toHaveLength(30);
    expect(normalizeRecipeNameForApp(name)).toBe(`${"a".repeat(29)}☕`);
  });
});
