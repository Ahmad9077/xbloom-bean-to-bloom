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

describe("production brew strength UI patch", () => {
  it("adds Strong/Soft segmented control to the new-recipe page", () => {
    const workerSource = readFileSync("index.js", "utf8");
    // Strength selector injected after the brew mode selector
    expect(workerSource).toContain('"aria-label":"Brew strength"');
    expect(workerSource).toContain('"Strong"');
    expect(workerSource).toContain('"Soft"');
    // Strong is initially selected (preselected state logic present)
    expect(workerSource).toContain('useState("strong")');
  });

  it("always appends strength to FormData on image submission", () => {
    const workerSource = readFileSync("index.js", "utf8");
    expect(workerSource).toContain('d.append("strength",');
  });

  it("shows non-editable strength chip in the confirmation dialog", () => {
    const workerSource = readFileSync("index.js", "utf8");
    // The patched fh confirmation component shows o.strength
    expect(workerSource).toContain("o.strength");
    expect(workerSource).toContain('"Strength"');
  });

  it("uses the approved strength-specific Hot sizes and defaults in confirmation", () => {
    const workerSource = readFileSync("index.js", "utf8");

    expect(workerSource).toContain('o.strength==="strong"?[210,224,238,252,266]:uh');
    expect(workerSource).toContain('o.strength==="strong"?252:255');
  });

  it("shows strength on the recipe result page", () => {
    const workerSource = readFileSync("index.js", "utf8");
    // Result page shows strength from the stored recipe
    expect(workerSource).toContain("o.strength&&");
    expect(workerSource).toContain(
      'o.strength&&i.jsx("p",{className:"mt-2 inline-flex rounded-full bg-ivory/10 px-3 py-1 text-xs font-semibold text-ivory/80"',
    );
  });

  it("cache-buster version reflects strength feature", () => {
    const workerSource = readFileSync("index.js", "utf8");
    expect(workerSource).toContain("strength-20260711");
  });
});
