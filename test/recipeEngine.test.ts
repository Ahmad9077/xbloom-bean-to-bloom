import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const { buildRecipe, getProfileOptions, RULES_VERSION, selectTableFinalDrinkMl } = (await import(
  String("../src/recipeEngine.js")
)) as {
  buildRecipe: (args: Record<string, unknown>) => {
    name: string;
    profile: string;
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
  getProfileOptions: () => unknown[];
  RULES_VERSION: string;
  selectTableFinalDrinkMl: (brewMode: "hot" | "cold", finalDrinkMl: number) => number;
};
const { RULES_VERSION: FINGERPRINT_RULES_VERSION } = (await import(
  String("../src/fingerprint.js")
)) as { RULES_VERSION: string };

const recipeTable = JSON.parse(
  readFileSync(fileURLToPath(String(new URL("../src/recipe-table.json", import.meta.url))), "utf8"),
) as {
  rulesVersion: string;
  recipes: Record<string, Record<"hot" | "cold", { sizes: Record<string, unknown> }>>;
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
  it("assembles a neutral_classic cold 300ml recipe from the table", () => {
    const recipe = buildRecipe({
      profile: "neutral_classic",
      brewMode: "cold",
      finalDrinkMl: 300,
      beanMeta,
      username: "admin",
      roastery: "Qayel",
      beanName: "Yemen",
    });

    expect(recipe.name).toBe("admin - Cold/Qayel/Yemen");
    expect(recipe.profile).toBe("neutral_classic");
    expect(recipe.rulesVersion).toBe("1.0.2");
    expect(recipe.machine).toBe("xBloom Studio");
    expect(recipe.dripper).toBe("Omni");
    expect(recipe.totalVolumeMl).toBe(176);
    expect(recipe.icedServing).toMatchObject({ iceG: 124, totalBeverageMl: 300 });
    expect(
      recipe.pours.reduce((sum: number, pour: { volumeMl: number }) => sum + pour.volumeMl, 0),
    ).toBe(176);
    expect(recipe.pours[0]).toMatchObject({
      label: "Bloom",
      volumeMl: 38,
      tempC: 93,
      flowRateMlPerSec: 3.5,
      pauseSec: 30,
      pattern: "spiral",
      agitationBefore: false,
    });
  });

  it("builds all 40 table cells inside xBloom hard limits", () => {
    let count = 0;
    for (const profile of Object.keys(recipeTable.recipes)) {
      for (const brewMode of ["hot", "cold"] as const) {
        const sizes = recipeTable.recipes[profile]?.[brewMode].sizes ?? {};
        for (const finalDrinkMl of Object.keys(sizes).map(Number)) {
          const recipe = buildRecipe({
            profile,
            brewMode,
            finalDrinkMl,
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
          expect(recipe.doseG).toBeLessThanOrEqual(18);
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
    expect(count).toBe(40);
  });

  it("maps legacy hot 250ml target to the nearest shadow-table size", () => {
    expect(selectTableFinalDrinkMl("hot", 250)).toBe(255);
    expect(selectTableFinalDrinkMl("cold", 300)).toBe(300);
  });

  it("single-sources the fingerprint and recipe engine rules version from the table", () => {
    expect(RULES_VERSION).toBe(recipeTable.rulesVersion);
    expect(FINGERPRINT_RULES_VERSION).toBe(recipeTable.rulesVersion);
  });

  it("keeps neutral_classic hot on the approved 1:15 ladder", () => {
    const neutralClassic = recipeTable.recipes.neutral_classic;
    expect(neutralClassic).toBeDefined();
    const sizes = neutralClassic?.hot.sizes as Record<
      string,
      { doseG: number; ratioN: number; waterMl: number }
    >;
    expect(
      [210, 225, 240, 255, 270].map((size) => {
        const cell = sizes[String(size)];
        expect(cell).toBeDefined();
        return {
          size,
          doseG: cell?.doseG,
          ratioN: cell?.ratioN,
          waterMl: cell?.waterMl,
        };
      }),
    ).toEqual([
      { size: 210, doseG: 14, ratioN: 15, waterMl: 210 },
      { size: 225, doseG: 15, ratioN: 15, waterMl: 225 },
      { size: 240, doseG: 16, ratioN: 15, waterMl: 240 },
      { size: 255, doseG: 17, ratioN: 15, waterMl: 255 },
      { size: 270, doseG: 18, ratioN: 15, waterMl: 270 },
    ]);
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
