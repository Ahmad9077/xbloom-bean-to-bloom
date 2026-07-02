import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production confirmation UI bundle patch", () => {
  it("does not expose manual recipe profile selection in the confirmation popup", () => {
    const workerSource = readFileSync("index.js", "utf8");

    expect(workerSource).not.toContain('children:"Recipe profile"');
    expect(workerSource).not.toContain("A.profile=ee");
    expect(workerSource).not.toContain("children:[o.machine,o.profile?");
    expect(workerSource).not.toContain("Check the profile if the coffee type looks different.");
    expect(workerSource).not.toContain("Your feedback helps calibrate this recipe profile.");
  });
});
