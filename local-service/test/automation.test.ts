import { describe, expect, it } from "vitest";
import { normalizePauseSecForApp } from "../src/automation.js";

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
