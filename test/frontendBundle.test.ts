import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production confirmation UI bundle patch", () => {
  it("shows roast selection and explicit-only profile override in the confirmation popup", () => {
    const workerSource = readFileSync("index.js", "utf8");

    expect(workerSource).toContain('children:["Roast level"');
    expect(workerSource).toContain('children:"Brew profile"');
    expect(workerSource).toContain('children:["Detected: ",oe(J)]');
    expect(workerSource).toContain("ee&&(A.profile=ee)");
    expect(workerSource).not.toContain("children:[o.machine,o.profile?");
    expect(workerSource).not.toContain("A.profile=J");
  });
});
