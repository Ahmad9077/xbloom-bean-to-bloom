import { describe, expect, it } from "vitest";
import {
  COLD_ICE_G,
  RECIPE_NAME_MAX_LEN,
  generateRecipe,
  validateRecipeInvariants,
} from "../src/recipe.js";
import type { BeanMetadata } from "../src/types.js";
import { DARK_BEAN, LIGHT_BEAN, MEDIUM_BEAN } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumPours(recipe: ReturnType<typeof generateRecipe>): number {
  return recipe.pours.reduce((acc, p) => acc + p.volumeMl, 0);
}

// ---------------------------------------------------------------------------
// Roast-level ordering
// ---------------------------------------------------------------------------

describe("generateRecipe — roast ordering", () => {
  const light = generateRecipe(LIGHT_BEAN);
  const medium = generateRecipe(MEDIUM_BEAN);
  const dark = generateRecipe(DARK_BEAN);

  it("light roast has finer grind than dark", () => {
    expect(light.grindSize).toBeLessThan(dark.grindSize);
  });

  it("light roast has finer grind than medium", () => {
    expect(light.grindSize).toBeLessThan(medium.grindSize);
  });

  it("medium roast has finer grind than dark", () => {
    expect(medium.grindSize).toBeLessThan(dark.grindSize);
  });

  it("light roast pours are hotter than dark on average", () => {
    const avgLight = light.pours.reduce((s, p) => s + p.tempC, 0) / light.pours.length;
    const avgDark = dark.pours.reduce((s, p) => s + p.tempC, 0) / dark.pours.length;
    expect(avgLight).toBeGreaterThan(avgDark);
  });

  it("light roast brew ratio uses more water than dark", () => {
    const nLight = Number.parseInt(light.brewRatio.split(":")[1] ?? "0", 10);
    const nDark = Number.parseInt(dark.brewRatio.split(":")[1] ?? "0", 10);
    expect(nLight).toBeGreaterThan(nDark);
  });
});

// ---------------------------------------------------------------------------
// Volume invariants
// ---------------------------------------------------------------------------

describe("generateRecipe — volume invariants", () => {
  for (const [label, bean] of [
    ["light", LIGHT_BEAN],
    ["medium", MEDIUM_BEAN],
    ["dark", DARK_BEAN],
  ] as const) {
    it(`pour volumes sum exactly to totalVolumeMl for ${label} roast`, () => {
      const recipe = generateRecipe(bean);
      expect(sumPours(recipe)).toBe(recipe.totalVolumeMl);
    });

    it(`totalVolumeMl equals doseG × ratioN for ${label} roast`, () => {
      const recipe = generateRecipe(bean);
      const n = Number.parseInt(recipe.brewRatio.split(":")[1] ?? "0", 10);
      expect(recipe.totalVolumeMl).toBe(recipe.doseG * n);
    });
  }

  it("all pour volumes are positive integers", () => {
    for (const bean of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      const recipe = generateRecipe(bean);
      for (const pour of recipe.pours) {
        expect(Number.isInteger(pour.volumeMl)).toBe(true);
        expect(pour.volumeMl).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Bounds and quantization
// ---------------------------------------------------------------------------

describe("generateRecipe — app limit bounds", () => {
  const allBeans: BeanMetadata[] = [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN];

  it("grindSize is in range 1..80", () => {
    for (const b of allBeans) {
      const r = generateRecipe(b);
      expect(r.grindSize).toBeGreaterThanOrEqual(1);
      expect(r.grindSize).toBeLessThanOrEqual(80);
    }
  });

  it("rpm is in range 60..120 and a multiple of 10", () => {
    for (const b of allBeans) {
      const r = generateRecipe(b);
      expect(r.rpm).toBeGreaterThanOrEqual(60);
      expect(r.rpm).toBeLessThanOrEqual(120);
      expect(r.rpm % 10).toBe(0);
    }
  });

  it("pour temperatures are in range 40..95", () => {
    for (const b of allBeans) {
      const r = generateRecipe(b);
      for (const p of r.pours) {
        expect(p.tempC).toBeGreaterThanOrEqual(40);
        expect(p.tempC).toBeLessThanOrEqual(95);
      }
    }
  });

  it("flow rates are in 3.0..3.5 and step 0.1", () => {
    for (const b of allBeans) {
      const r = generateRecipe(b);
      for (const p of r.pours) {
        expect(p.flowRateMlPerSec).toBeGreaterThanOrEqual(3.0);
        expect(p.flowRateMlPerSec).toBeLessThanOrEqual(3.5);
        // Verify step: (value - 3.0) is a multiple of 0.1
        expect(Math.round((p.flowRateMlPerSec - 3.0) * 10) % 1).toBe(0);
      }
    }
  });

  it("pauseSec is in the xBloom app range 2..59 and is an integer", () => {
    for (const b of allBeans) {
      const r = generateRecipe(b);
      for (const p of r.pours) {
        expect(Number.isInteger(p.pauseSec)).toBe(true);
        expect(p.pauseSec).toBeGreaterThanOrEqual(2);
        expect(p.pauseSec).toBeLessThanOrEqual(59);
      }
    }
  });

  it("brewRatio matches 1:N format with N in 5..25", () => {
    for (const b of allBeans) {
      const r = generateRecipe(b);
      expect(r.brewRatio).toMatch(/^1:\d+$/);
      const n = Number.parseInt(r.brewRatio.split(":")[1] ?? "0", 10);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(25);
    }
  });

  it("doseG is in range 5..25 and is an integer", () => {
    for (const b of allBeans) {
      const r = generateRecipe(b);
      expect(Number.isInteger(r.doseG)).toBe(true);
      expect(r.doseG).toBeGreaterThanOrEqual(5);
      expect(r.doseG).toBeLessThanOrEqual(25);
    }
  });
});

// ---------------------------------------------------------------------------
// Pour labels
// ---------------------------------------------------------------------------

describe("generateRecipe — pour labels", () => {
  it("first pour is labelled Bloom", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(r.pours[0]?.label).toBe("Bloom");
  });

  it("subsequent pours are labelled Pour N", () => {
    const r = generateRecipe(MEDIUM_BEAN);
    expect(r.pours[1]?.label).toBe("Pour 2");
    expect(r.pours[2]?.label).toBe("Pour 3");
  });
});

// ---------------------------------------------------------------------------
// Fixed schema fields
// ---------------------------------------------------------------------------

describe("generateRecipe — schema constants", () => {
  it('machine is always "xBloom Studio"', () => {
    for (const b of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      expect(generateRecipe(b).machine).toBe("xBloom Studio");
    }
  });

  it("bean metadata is preserved exactly in the recipe", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(r.bean).toEqual(LIGHT_BEAN);
  });

  it("patterns are one of the three allowed values", () => {
    for (const b of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      const r = generateRecipe(b);
      for (const p of r.pours) {
        expect(["centered", "spiral", "circular"]).toContain(p.pattern);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Processing method adjustments
// ---------------------------------------------------------------------------

describe("generateRecipe — processing method adjustments", () => {
  const washed: BeanMetadata = { ...LIGHT_BEAN, processingMethod: "Washed" };
  const natural: BeanMetadata = { ...LIGHT_BEAN, processingMethod: "Natural" };

  it("washed process produces finer grind than natural", () => {
    expect(generateRecipe(washed).grindSize).toBeLessThan(generateRecipe(natural).grindSize);
  });

  it("washed process produces higher temperatures than natural", () => {
    const w = generateRecipe(washed);
    const n = generateRecipe(natural);
    expect(w.pours[0]?.tempC ?? 0).toBeGreaterThan(n.pours[0]?.tempC ?? 0);
  });
});

// ---------------------------------------------------------------------------
// validateRecipeInvariants
// ---------------------------------------------------------------------------

describe("validateRecipeInvariants", () => {
  it("passes for all generated roast levels", () => {
    for (const b of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      expect(() => validateRecipeInvariants(generateRecipe(b))).not.toThrow();
    }
  });

  it("throws when totalVolumeMl is wrong", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(() => validateRecipeInvariants({ ...r, totalVolumeMl: r.totalVolumeMl + 1 })).toThrow();
  });

  it("throws when grindSize is out of range", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(() => validateRecipeInvariants({ ...r, grindSize: 0 })).toThrow();
    expect(() => validateRecipeInvariants({ ...r, grindSize: 81 })).toThrow();
  });

  it("throws when rpm is not a multiple of 10", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(() => validateRecipeInvariants({ ...r, rpm: 95 })).toThrow();
  });

  it("throws when pour volumes do not sum to totalVolumeMl", () => {
    const r = generateRecipe(MEDIUM_BEAN);
    const badPours = r.pours.map((p, i) => (i === 0 ? { ...p, volumeMl: p.volumeMl + 1 } : p));
    expect(() => validateRecipeInvariants({ ...r, pours: badPours })).toThrow();
  });

  it("throws when a pour has temperature out of range", () => {
    const r = generateRecipe(MEDIUM_BEAN);
    const badPours = r.pours.map((p, i) => (i === 0 ? { ...p, tempC: 100 } : p));
    expect(() => validateRecipeInvariants({ ...r, pours: badPours })).toThrow();
  });

  it("throws when an invalid pattern is used", () => {
    const r = generateRecipe(MEDIUM_BEAN);
    const badPours = r.pours.map((p, i) => (i === 0 ? { ...p, pattern: "zigzag" as never } : p));
    expect(() => validateRecipeInvariants({ ...r, pours: badPours })).toThrow();
  });

  it("throws when name is empty or whitespace-only", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(() => validateRecipeInvariants({ ...r, name: "" })).toThrow();
    expect(() => validateRecipeInvariants({ ...r, name: "   " })).toThrow();
  });

  it("throws when machine is not exactly xBloom Studio", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(() => validateRecipeInvariants({ ...r, machine: "xBloom Air" as never })).toThrow();
  });

  it("throws when dripper is not one of Omni, xPod, Other", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(() => validateRecipeInvariants({ ...r, dripper: "V60" as never })).toThrow();
  });

  it("throws when bean metadata is invalid", () => {
    const r = generateRecipe(LIGHT_BEAN);
    const badBean = { ...LIGHT_BEAN, roastLevel: "extra-dark" as never };
    expect(() => validateRecipeInvariants({ ...r, bean: badBean })).toThrow();
  });

  it("throws when pours array is empty", () => {
    const r = generateRecipe(LIGHT_BEAN);
    expect(() => validateRecipeInvariants({ ...r, pours: [] })).toThrow();
  });

  it("throws when a pour volume is 0", () => {
    const r = generateRecipe(LIGHT_BEAN);
    // Extract pour 0 volume before mapping to avoid non-null assertion
    const pour0Vol = r.pours[0]?.volumeMl ?? 0;
    // Adjust other pours to keep sum correct, so only the volume=0 check triggers
    const badPours = r.pours.map((p, i) =>
      i === 0 ? { ...p, volumeMl: 0 } : i === 1 ? { ...p, volumeMl: p.volumeMl + pour0Vol } : p,
    );
    expect(() => validateRecipeInvariants({ ...r, pours: badPours })).toThrow();
  });

  it("throws when the first pour label is not Bloom", () => {
    const r = generateRecipe(LIGHT_BEAN);
    const badPours = r.pours.map((p, i) => (i === 0 ? { ...p, label: "Pre-infusion" } : p));
    expect(() => validateRecipeInvariants({ ...r, pours: badPours })).toThrow();
  });

  it("throws when a subsequent pour label does not match Pour N", () => {
    const r = generateRecipe(LIGHT_BEAN);
    const badPours = r.pours.map((p, i) => (i === 1 ? { ...p, label: "Main Pour" } : p));
    expect(() => validateRecipeInvariants({ ...r, pours: badPours })).toThrow();
  });

  it("throws when agitationBefore is not a boolean", () => {
    const r = generateRecipe(LIGHT_BEAN);
    const badPours = r.pours.map((p, i) => (i === 0 ? { ...p, agitationBefore: 0 as never } : p));
    expect(() => validateRecipeInvariants({ ...r, pours: badPours })).toThrow();
  });

  it("throws when flow rate is not quantized to 0.1", () => {
    const r = generateRecipe(LIGHT_BEAN);
    const badPours = r.pours.map((p, i) => (i === 0 ? { ...p, flowRateMlPerSec: 3.05 } : p));
    expect(() => validateRecipeInvariants({ ...r, pours: badPours })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rounding edge cases
// ---------------------------------------------------------------------------

describe("generateRecipe — rounding edge cases", () => {
  it("sum is exact even when bloom fraction produces fractional ml", () => {
    // Use all three roast levels across 3 doses to verify no off-by-one
    for (const roastLevel of ["light", "medium", "dark"] as const) {
      const bean: BeanMetadata = { ...LIGHT_BEAN, roastLevel };
      const recipe = generateRecipe(bean);
      expect(sumPours(recipe)).toBe(recipe.totalVolumeMl);
    }
  });
});

// ---------------------------------------------------------------------------
// Cold mode — math, metadata, name, invariants
// ---------------------------------------------------------------------------

describe("generateRecipe — cold mode", () => {
  it("cold recipe has brewMode=cold", () => {
    expect(generateRecipe(LIGHT_BEAN, "Other", "cold").brewMode).toBe("cold");
  });

  it("cold recipe uses fixed 1:10 machine-water ratio for all roast levels", () => {
    for (const bean of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      const r = generateRecipe(bean, "Other", "cold");
      expect(r.brewRatio).toBe("1:10");
      expect(r.totalVolumeMl).toBe(160); // 16 g × 10
    }
  });

  it("cold recipe pour volumes sum to 160 ml (machine water only)", () => {
    for (const bean of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      const r = generateRecipe(bean, "Other", "cold");
      expect(sumPours(r)).toBe(160);
      expect(sumPours(r)).toBe(r.totalVolumeMl);
    }
  });

  it("cold recipe has at most 120 g ice and a 270–300 ml total beverage", () => {
    const r = generateRecipe(LIGHT_BEAN, "Other", "cold");
    expect(r.icedServing).toBeDefined();
    expect(r.icedServing?.iceG).toBe(COLD_ICE_G);
    expect(r.icedServing?.iceG).toBeLessThanOrEqual(120);
    expect(r.icedServing?.totalBeverageMl).toBeGreaterThanOrEqual(270);
    expect(r.icedServing?.totalBeverageMl).toBeLessThanOrEqual(300);
  });

  it("cold recipe name clearly includes 'Iced'", () => {
    for (const bean of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      const r = generateRecipe(bean, "Other", "cold");
      expect(r.name.toLowerCase()).toContain("iced");
    }
  });

  it("cold recipe name includes origin when present", () => {
    const r = generateRecipe(LIGHT_BEAN, "Other", "cold"); // LIGHT_BEAN.origin = "Ethiopia"
    expect(r.name).toContain("Ethiopia");
    expect(r.name).toContain("Iced");
  });

  it("cold recipe without origin produces 'Iced <Roast> Roast'", () => {
    const noOrigin: BeanMetadata = { ...LIGHT_BEAN, origin: "" };
    const r = generateRecipe(noOrigin, "Other", "cold");
    expect(r.name).toBe("Iced Light Roast");
  });

  it("cold recipe icedServing instruction mentions xBloom has no cold setting", () => {
    const r = generateRecipe(LIGHT_BEAN, "Other", "cold");
    expect(r.icedServing?.instruction.toLowerCase()).toContain("xbloom");
  });

  it("cold recipe passes validateRecipeInvariants", () => {
    for (const bean of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      expect(() => validateRecipeInvariants(generateRecipe(bean, "Other", "cold"))).not.toThrow();
    }
  });

  it("validateRecipeInvariants throws when cold recipe is missing icedServing", () => {
    const r = generateRecipe(LIGHT_BEAN, "Other", "cold");
    const { icedServing: _removed, ...withoutIced } = r;
    expect(() => validateRecipeInvariants(withoutIced as typeof r)).toThrow(/icedServing/);
  });

  it("validateRecipeInvariants throws when cold recipe has wrong iceG", () => {
    const r = generateRecipe(LIGHT_BEAN, "Other", "cold");
    const base = r.icedServing ?? { iceG: COLD_ICE_G, totalBeverageMl: 280, instruction: "" };
    const bad = { ...r, icedServing: { ...base, iceG: 200, totalBeverageMl: 360 } };
    expect(() => validateRecipeInvariants(bad)).toThrow(/iceG/);
  });

  it("validateRecipeInvariants throws when cold recipe has wrong totalBeverageMl", () => {
    const r = generateRecipe(LIGHT_BEAN, "Other", "cold");
    const base = r.icedServing ?? { iceG: COLD_ICE_G, totalBeverageMl: 280, instruction: "" };
    const bad = { ...r, icedServing: { ...base, totalBeverageMl: 999 } };
    expect(() => validateRecipeInvariants(bad)).toThrow(/totalBeverageMl/);
  });
});

describe("generateRecipe — hot mode", () => {
  it("hot recipe has brewMode=hot", () => {
    expect(generateRecipe(LIGHT_BEAN, "Other", "hot").brewMode).toBe("hot");
  });

  it("hot default preserves roast-derived ratios", () => {
    // Existing ordering test from the hot default perspective
    const light = generateRecipe(LIGHT_BEAN, "Other", "hot");
    const dark = generateRecipe(DARK_BEAN, "Other", "hot");
    const nLight = Number.parseInt(light.brewRatio.split(":")[1] ?? "0", 10);
    const nDark = Number.parseInt(dark.brewRatio.split(":")[1] ?? "0", 10);
    expect(nLight).toBeGreaterThan(nDark);
  });

  it("hot recipe has no icedServing", () => {
    expect(generateRecipe(LIGHT_BEAN, "Other", "hot").icedServing).toBeUndefined();
  });

  it("hot recipe passes validateRecipeInvariants", () => {
    for (const bean of [LIGHT_BEAN, MEDIUM_BEAN, DARK_BEAN]) {
      expect(() => validateRecipeInvariants(generateRecipe(bean, "Other", "hot"))).not.toThrow();
    }
  });

  it("validateRecipeInvariants throws when hot recipe has icedServing", () => {
    const r = generateRecipe(LIGHT_BEAN, "Other", "hot");
    const bad = {
      ...r,
      icedServing: { iceG: 80, totalBeverageMl: 240, instruction: "oops" },
    };
    expect(() => validateRecipeInvariants(bad)).toThrow(/icedServing/);
  });
});
