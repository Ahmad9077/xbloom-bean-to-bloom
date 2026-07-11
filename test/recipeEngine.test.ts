import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const {
  buildRecipe,
  ENGINE_VERSION,
  getProfileOptions,
  getRecipePlan,
  RULES_VERSION,
  selectTableFinalDrinkMl,
} = (await import(String("../src/recipeEngine.js"))) as {
  buildRecipe: (args: Record<string, unknown>) => {
    name: string;
    engine?: string;
    engineVersion?: string;
    tasteRationale?: string;
    retuneRevision?: number;
    profile: string;
    strength: string;
    rulesVersion: string;
    machine: string;
    dripper: string;
    totalVolumeMl: number;
    doseG: number;
    brewRatio: string;
    grindSize: number;
    rpm: number;
    icedServing?: { iceG: number; totalBeverageMl: number };
    pours: Array<{
      label: string;
      volumeMl: number;
      tempC: number;
      flowRateMlPerSec: number;
      pauseSec: number;
      pattern: string;
      agitationBefore: boolean;
    }>;
  };
  ENGINE_VERSION: string;
  getProfileOptions: () => unknown[];
  getRecipePlan: (args: Record<string, unknown>) => {
    constraints: {
      grindBand: number[];
      tempRange: number[];
      rpmRange: number[];
      fixed: {
        doseG: number;
        ratioN: number;
        waterMl: number;
        pourVolumes: number[];
      };
    };
  };
  RULES_VERSION: string;
  selectTableFinalDrinkMl: (
    brewMode: "hot" | "cold",
    finalDrinkMl: number,
    strength: "strong" | "soft",
  ) => number;
};
const { RULES_VERSION: FINGERPRINT_RULES_VERSION } = (await import(
  String("../src/fingerprint.js")
)) as { RULES_VERSION: string };

const recipeTable = JSON.parse(
  readFileSync(fileURLToPath(String(new URL("../src/recipe-table.json", import.meta.url))), "utf8"),
) as {
  rulesVersion: string;
  recipes: Record<
    string,
    Record<
      "hot" | "cold",
      {
        params: { grindBand: number[]; tempRange: number[] };
        sizes: Record<string, unknown>;
      }
    >
  >;
};

const beanMeta = {
  beanName: "Yemen",
  coffeeType: "Arabica",
  variety: "Tipica / Bourbon",
  origin: "Yemen",
  processingMethod: "Natural",
  roastLevel: "medium",
  flavors: ["red fruits", "spices"],
  description: "Red fruits, spices, caramel",
};

describe("buildRecipe", () => {
  it("rejects missing strength in core table selection", () => {
    expect(() =>
      getRecipePlan({ profile: "bright_clean", brewMode: "hot", finalDrinkMl: 240 }),
    ).toThrow(/strength/i);
    expect(() => selectTableFinalDrinkMl("hot", 240, undefined as never)).toThrow(/strength/i);
  });

  it("assembles a neutral_classic cold 300ml soft recipe from the table", () => {
    const recipe = buildRecipe({
      profile: "neutral_classic",
      brewMode: "cold",
      finalDrinkMl: 300,
      strength: "soft",
      beanMeta,
      username: "admin",
      roastery: "Qayel",
      beanName: "Yemen",
    });

    expect(recipe.name).toBe("admin - Cold/Qayel/Yemen");
    expect(recipe.profile).toBe("neutral_classic");
    expect(recipe.rulesVersion).toBe(recipeTable.rulesVersion);
    expect(recipe.machine).toBe("xBloom Studio");
    expect(recipe.dripper).toBe("Other");
    // v1.3.0 soft 300ml: dose18 water180 ice120 → totalVolumeMl=180
    expect(recipe.totalVolumeMl).toBe(180);
    expect(recipe.icedServing).toMatchObject({ iceG: 120, totalBeverageMl: 300 });
    expect(
      recipe.pours.reduce((sum: number, pour: { volumeMl: number }) => sum + pour.volumeMl, 0),
    ).toBe(180);
    expect(recipe.pours[0]).toMatchObject({
      label: "Bloom",
      volumeMl: 40,
      tempC: 93,
      flowRateMlPerSec: 3.5,
      pauseSec: 30,
      pattern: "spiral",
      agitationBefore: false,
    });
    expect(recipe.strength).toBe("soft");
  });

  it("lets hybrid tuning change only guardrailed machine variables, not table-fixed structure", () => {
    const plan = getRecipePlan({
      profile: "bright_clean",
      brewMode: "hot",
      finalDrinkMl: 238,
      strength: "strong",
    });
    const minTemp = plan.constraints.tempRange[0] ?? 0;
    const maxTemp = plan.constraints.tempRange[1] ?? minTemp;
    const recipe = buildRecipe({
      profile: "bright_clean",
      brewMode: "hot",
      finalDrinkMl: 238,
      strength: "strong",
      beanMeta,
      username: "admin",
      roastery: "OPT",
      beanName: "Yemenia",
      engine: "hybrid",
      engineVersion: ENGINE_VERSION,
      tasteRationale: "Natural Yemen gets finer grind and hotter first pours for fruit clarity.",
      retuneRevision: 1,
      tuning: {
        grindSize: plan.constraints.grindBand[0],
        rpm: plan.constraints.rpmRange[1],
        pours: [
          {
            tempC: plan.constraints.tempRange[1],
            flowRateMlPerSec: 3,
            pauseSec: 45,
            pattern: "spiral",
            agitationBefore: true,
            agitationAfter: false,
          },
          {
            tempC: maxTemp - 1,
            flowRateMlPerSec: 3.3,
            pauseSec: 18,
            pattern: "circular",
            agitationBefore: false,
            agitationAfter: false,
          },
          {
            tempC: minTemp,
            flowRateMlPerSec: 3.5,
            pauseSec: 5,
            pattern: "centered",
            agitationBefore: false,
            agitationAfter: true,
          },
        ],
      },
    });

    expect(recipe.engine).toBe("hybrid");
    expect(recipe.engineVersion).toBe(ENGINE_VERSION);
    expect(recipe.retuneRevision).toBe(1);
    expect(recipe.tasteRationale).toContain("Yemen");
    expect(recipe.doseG).toBe(plan.constraints.fixed.doseG);
    expect(recipe.brewRatio).toBe(`1:${plan.constraints.fixed.ratioN}`);
    expect(recipe.totalVolumeMl).toBe(plan.constraints.fixed.waterMl);
    expect(recipe.pours.map((pour) => pour.volumeMl)).toEqual(plan.constraints.fixed.pourVolumes);
    expect(recipe.grindSize).toBe(plan.constraints.grindBand[0]);
    expect(recipe.rpm).toBe(plan.constraints.rpmRange[1]);
    expect(recipe.pours[0]).toMatchObject({
      tempC: maxTemp,
      flowRateMlPerSec: 3,
      pauseSec: 45,
      pattern: "spiral",
      agitationBefore: true,
    });
  });

  it("builds all 80 table cells inside xBloom hard limits (4 profiles × 2 modes × 5 sizes × 2 strengths)", () => {
    const table = recipeTable as unknown as {
      recipes: Record<
        string,
        Record<
          "hot" | "cold",
          { sizesByStrength: Record<"strong" | "soft", Record<string, unknown>> }
        >
      >;
    };
    let count = 0;
    for (const profile of Object.keys(table.recipes)) {
      for (const brewMode of ["hot", "cold"] as const) {
        const sizesByStrength = (table.recipes[profile]?.[brewMode].sizesByStrength ??
          {}) as Record<string, Record<string, unknown>>;
        for (const strength of ["strong", "soft"] as const) {
          const sizes = sizesByStrength[strength] ?? {};
          for (const finalDrinkMl of Object.keys(sizes).map(Number)) {
            const recipe = buildRecipe({
              profile,
              brewMode,
              finalDrinkMl,
              strength,
              beanMeta,
              username: "admin",
              roastery: "Qayel",
              beanName: "Yemen",
            });

            expect(
              recipe.pours.reduce(
                (sum: number, pour: { volumeMl: number }) => sum + pour.volumeMl,
                0,
              ),
            ).toBe(recipe.totalVolumeMl);
            expect(recipe.totalVolumeMl).toBe(
              recipe.doseG * Number.parseInt(recipe.brewRatio.slice(2), 10),
            );
            expect(recipe.doseG).toBeGreaterThanOrEqual(5);
            expect(recipe.doseG).toBeLessThanOrEqual(25);
            expect(recipe.grindSize).toBeGreaterThanOrEqual(1);
            expect(recipe.grindSize).toBeLessThanOrEqual(80);
            expect(recipe.rpm).toBeGreaterThanOrEqual(60);
            expect(recipe.rpm).toBeLessThanOrEqual(120);
            expect(recipe.rpm % 10).toBe(0);
            for (const pour of recipe.pours) {
              expect(pour.tempC).toBeGreaterThanOrEqual(40);
              expect(pour.tempC).toBeLessThanOrEqual(95);
              expect(pour.flowRateMlPerSec).toBeGreaterThanOrEqual(3);
              expect(pour.flowRateMlPerSec).toBeLessThanOrEqual(3.5);
              expect(pour.pauseSec).toBeGreaterThanOrEqual(2);
              expect(pour.pauseSec).toBeLessThanOrEqual(59);
            }
            count += 1;
          }
        }
      }
    }
    expect(count).toBe(80);
  });

  it("v1.3.0 Hot Soft uses ratioN=15 for all profiles", () => {
    const table = recipeTable as unknown as {
      recipes: Record<
        string,
        Record<
          "hot",
          {
            sizesByStrength: Record<
              "soft",
              Record<string, { doseG: number; ratioN: number; waterMl: number }>
            >;
          }
        >
      >;
    };
    for (const profile of ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"]) {
      const softSizes = table.recipes[profile]?.hot.sizesByStrength.soft ?? {};
      for (const [sizeStr, cell] of Object.entries(softSizes)) {
        expect(cell.ratioN).toBe(15);
        expect(cell.waterMl).toBe(Number(sizeStr));
        expect(cell.doseG * 15).toBe(cell.waterMl);
      }
    }
  });

  it("v1.3.0 Hot Strong uses ratioN=14 for all profiles", () => {
    const table = recipeTable as unknown as {
      recipes: Record<
        string,
        Record<
          "hot",
          {
            sizesByStrength: Record<
              "strong",
              Record<string, { doseG: number; ratioN: number; waterMl: number }>
            >;
          }
        >
      >;
    };
    for (const profile of ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"]) {
      const strongSizes = table.recipes[profile]?.hot.sizesByStrength.strong ?? {};
      for (const [sizeStr, cell] of Object.entries(strongSizes)) {
        expect(cell.ratioN).toBe(14);
        expect(cell.doseG * 14).toBe(cell.waterMl);
        const finalDrinkMl = Number(sizeStr);
        expect(cell.waterMl).toBe(finalDrinkMl);
      }
    }
  });

  it("v1.3.0 Hot Strong approved menu sizes match spec", () => {
    const menu = (
      recipeTable as unknown as { menus: { hot: { finalDrinkMlByStrength: { strong: number[] } } } }
    ).menus.hot.finalDrinkMlByStrength.strong;
    expect(menu).toEqual([210, 224, 238, 252, 266]);
  });

  it("v1.3.0 Cold Strong is more concentrated than Cold Soft for every profile and size", () => {
    const table = recipeTable as unknown as {
      recipes: Record<
        string,
        Record<
          "cold",
          {
            sizesByStrength: Record<
              "strong" | "soft",
              Record<string, { doseG: number; ratioN: number; waterMl: number; iceG: number }>
            >;
          }
        >
      >;
    };
    for (const profile of ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"]) {
      for (const sizeStr of ["240", "270", "300", "330", "360"]) {
        const strong = table.recipes[profile]?.cold.sizesByStrength.strong[sizeStr];
        const soft = table.recipes[profile]?.cold.sizesByStrength.soft[sizeStr];
        expect(strong).toBeDefined();
        expect(soft).toBeDefined();
        if (!strong || !soft) continue;
        // Strong has lower ratioN (more concentrated)
        expect(strong.ratioN).toBeLessThanOrEqual(soft.ratioN);
        // Strong has higher dose per finalDrink
        expect(strong.doseG).toBeGreaterThanOrEqual(soft.doseG);
        // waterMl + iceG = finalDrinkMl
        expect(strong.waterMl + strong.iceG).toBe(Number(sizeStr));
        expect(soft.waterMl + soft.iceG).toBe(Number(sizeStr));
        // ice in 96-144g window
        expect(strong.iceG).toBeGreaterThanOrEqual(96);
        expect(strong.iceG).toBeLessThanOrEqual(144);
        expect(soft.iceG).toBeGreaterThanOrEqual(96);
        expect(soft.iceG).toBeLessThanOrEqual(144);
      }
    }
  });

  it("v1.3.0 Cold Soft pour sums equal waterMl for all profiles", () => {
    const table = recipeTable as unknown as {
      recipes: Record<
        string,
        Record<
          "cold",
          {
            sizesByStrength: Record<
              "soft",
              Record<string, { waterMl: number; pours: Array<{ volumeMl: number }> }>
            >;
          }
        >
      >;
    };
    for (const profile of ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"]) {
      const softSizes = table.recipes[profile]?.cold.sizesByStrength.soft ?? {};
      for (const [sizeStr, cell] of Object.entries(softSizes)) {
        const pourSum = cell.pours.reduce((s, p) => s + p.volumeMl, 0);
        expect(pourSum).toBe(cell.waterMl);
      }
    }
  });

  it("selectTableFinalDrinkMl respects strength-specific menus for hot", () => {
    // Hot soft menu: [210, 225, 240, 255, 270]
    expect(selectTableFinalDrinkMl("hot", 250, "soft")).toBe(255);
    expect(selectTableFinalDrinkMl("hot", 210, "soft")).toBe(210);
    // Hot strong menu: [210, 224, 238, 252, 266]
    expect(selectTableFinalDrinkMl("hot", 250, "strong")).toBe(252);
    expect(selectTableFinalDrinkMl("hot", 210, "strong")).toBe(210);
    // Cold same for both
    expect(selectTableFinalDrinkMl("cold", 300, "strong")).toBe(300);
    expect(selectTableFinalDrinkMl("cold", 300, "soft")).toBe(300);
  });

  it("single-sources the fingerprint and recipe engine rules version from the table", () => {
    expect(RULES_VERSION).toBe(recipeTable.rulesVersion);
    expect(FINGERPRINT_RULES_VERSION).toBe(recipeTable.rulesVersion);
  });

  it("v1.3.0 rules version bump from 1.2.0", () => {
    expect(recipeTable.rulesVersion).toBe("1.3.0");
  });

  it("widens hot extraction bands (unchanged from 1.2.0)", () => {
    expect(recipeTable.recipes.bright_clean?.hot.params).toMatchObject({
      grindBand: [30, 42],
      tempRange: [91, 95],
    });
    expect(recipeTable.recipes.bright_funky?.hot.params).toMatchObject({
      grindBand: [32, 44],
      tempRange: [88, 95],
    });
    expect(recipeTable.recipes.neutral_classic?.hot.params).toMatchObject({
      grindBand: [36, 48],
      tempRange: [90, 95],
    });
    expect(recipeTable.recipes.dark_roasty?.hot.params).toMatchObject({
      grindBand: [40, 52],
      tempRange: [84, 95],
    });
  });

  it("v1.3.0 Hot Soft 1:15 ladder — all profiles use the approved soft cells", () => {
    const table = recipeTable as unknown as {
      recipes: Record<
        string,
        Record<
          "hot",
          {
            sizesByStrength: Record<
              "soft",
              Record<string, { doseG: number; ratioN: number; waterMl: number }>
            >;
          }
        >
      >;
    };
    const expectedSoft = [
      { size: 210, doseG: 14, ratioN: 15, waterMl: 210 },
      { size: 225, doseG: 15, ratioN: 15, waterMl: 225 },
      { size: 240, doseG: 16, ratioN: 15, waterMl: 240 },
      { size: 255, doseG: 17, ratioN: 15, waterMl: 255 },
      { size: 270, doseG: 18, ratioN: 15, waterMl: 270 },
    ];
    for (const profile of ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"]) {
      const softSizes = table.recipes[profile]?.hot.sizesByStrength.soft ?? {};
      for (const { size, doseG, ratioN, waterMl } of expectedSoft) {
        const cell = softSizes[String(size)];
        expect(cell).toBeDefined();
        expect(cell).toMatchObject({ doseG, ratioN, waterMl });
      }
    }
  });

  it("v1.3.0 Cold Soft cells within approved ice and dose windows", () => {
    const table = recipeTable as unknown as {
      recipes: Record<
        string,
        Record<
          "cold",
          {
            sizesByStrength: Record<
              "soft",
              Record<string, { doseG: number; ratioN: number; waterMl: number; iceG: number }>
            >;
          }
        >
      >;
    };
    for (const profile of ["bright_clean", "bright_funky", "neutral_classic", "dark_roasty"]) {
      const softSizes = table.recipes[profile]?.cold.sizesByStrength.soft ?? {};
      for (const size of [240, 270, 300, 330, 360]) {
        const cell = softSizes[String(size)];
        expect(cell).toBeDefined();
        if (!cell) continue;
        expect(cell.doseG).toBeGreaterThanOrEqual(5);
        expect(cell.doseG).toBeLessThanOrEqual(25);
        expect(cell.waterMl + cell.iceG).toBe(size);
        expect(cell.iceG).toBeGreaterThanOrEqual(96);
        expect(cell.iceG).toBeLessThanOrEqual(144);
        // Cold Soft ratioN = 10 for bright/neutral, 11 for dark
        expect(cell.ratioN).toBeGreaterThanOrEqual(10);
        expect(cell.ratioN).toBeLessThanOrEqual(11);
      }
    }
  });

  it("exposes frontend profile options from the table", () => {
    expect(getProfileOptions()).toEqual([
      expect.objectContaining({
        id: "bright_clean",
        labelEn: expect.any(String),
        labelAr: expect.any(String),
        emoji: expect.any(String),
      }),
      expect.objectContaining({ id: "bright_funky" }),
      expect.objectContaining({ id: "neutral_classic" }),
      expect.objectContaining({ id: "dark_roasty" }),
    ]);
  });
});
