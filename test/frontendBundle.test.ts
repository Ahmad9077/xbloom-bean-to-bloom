import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production confirmation UI bundle patch", () => {
  it("shows roast selection and detected profile without any manual profile override", () => {
    const workerSource = readFileSync("index.js", "utf8");

    expect(workerSource).toContain('children:["Roast level"');
    expect(workerSource).toContain('children:"Brew profile"');
    expect(workerSource).toContain('children:["Preliminary guess: ",oe(ee)]');
    expect(workerSource).toContain("Final profile is chosen after you confirm the bean details.");
    expect(workerSource).not.toContain('i.jsx("option",{value:"",children:"unknown"})');
    expect(workerSource).not.toContain("ee&&(A.profile=ee)");
    expect(workerSource).not.toContain("Use detected");
    expect(workerSource).not.toContain("onClick:()=>se(A.id)");
    expect(workerSource).not.toContain("children:[o.machine,o.profile?");
    expect(workerSource).not.toContain("A.profile=J");
  });

  it("renders the final stored profile on the recipe result page", () => {
    const workerSource = readFileSync("index.js", "utf8");

    expect(workerSource).toContain(
      'profileLabels={bright_clean:"☀️ Bright & fruity",bright_funky:"🍓 Funky natural",neutral_classic:"⚖️ Classic balanced",dark_roasty:"🍫 Dark & roasty"}',
    );
    expect(workerSource).toContain("actualProfileLabel=o.profile");
    expect(workerSource).toContain("children:actualProfileLabel");
  });
});
