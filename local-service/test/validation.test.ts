import { describe, expect, it } from "vitest";
import { ErrorCode } from "../src/errors.js";
import { validateRequest } from "../src/validation.js";

const bloomPour = {
  label: "Bloom",
  volumeMl: 40,
  tempC: 93,
  flowRateMlPerSec: 3.0,
  pauseSec: 30,
  pattern: "centered",
  agitationBefore: false,
  agitationAfter: false,
};

const validRecipe = {
  name: "Test Recipe",
  machine: "xBloom Studio",
  dripper: "Omni",
  brewRatio: "1:15",
  totalVolumeMl: 225,
  doseG: 15,
  grindSize: 23,
  rpm: 90,
  pours: [{ ...bloomPour, volumeMl: 225 }],
};

const validBody = { recipe: validRecipe, confirmSave: true };

describe("validateRequest", () => {
  it("accepts a valid confirmSave request", () => {
    const result = validateRequest(validBody);
    expect(result.recipe.name).toBe("Test Recipe");
    expect(result.confirmSave).toBe(true);
  });

  it.each(["light", "medium_light", "medium", "medium_dark", "dark", "unknown"])(
    "accepts Worker roast level %s in bean metadata",
    (roastLevel) => {
      const recipe = {
        ...validRecipe,
        bean: {
          beanName: "LaPradera",
          storeName: "Soil",
          coffeeType: "Arabica",
          variety: "Castillo",
          origin: "Colombia",
          processingMethod: "anaerobic honey",
          roastLevel,
          flavors: ["floral", "strawberry"],
          description: "Bridge-compatible bean metadata",
        },
      };

      expect(() => validateRequest({ recipe, confirmSave: true })).not.toThrow();
    },
  );

  it("accepts a valid dryRun request", () => {
    const result = validateRequest({ recipe: validRecipe, dryRun: true });
    expect(result.dryRun).toBe(true);
  });

  it("rejects machine !== xBloom Studio", () => {
    const body = { recipe: { ...validRecipe, machine: "xBloom Original" }, confirmSave: true };
    expect(() => validateRequest(body)).toThrowError(
      expect.objectContaining({ code: ErrorCode.MACHINE_NOT_SUPPORTED }),
    );
  });

  it("rejects xBloom Original explicitly", () => {
    const body = { recipe: { ...validRecipe, machine: "xBloom Original" }, dryRun: true };
    expect(() => validateRequest(body)).toThrowError(/xBloom Studio/);
  });

  it("rejects when neither dryRun nor confirmSave is true", () => {
    expect(() => validateRequest({ recipe: validRecipe })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("rejects when both dryRun and confirmSave are true", () => {
    expect(() =>
      validateRequest({ recipe: validRecipe, dryRun: true, confirmSave: true }),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }));
  });

  it("rejects inconsistent totalVolumeMl vs dose*ratio", () => {
    const body = {
      recipe: { ...validRecipe, totalVolumeMl: 220 },
      confirmSave: true,
    };
    expect(() => validateRequest(body)).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("rejects when pour sum does not match totalVolumeMl", () => {
    const body = {
      recipe: {
        ...validRecipe,
        pours: [{ ...bloomPour, volumeMl: 100 }],
      },
      confirmSave: true,
    };
    expect(() => validateRequest(body)).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("accepts bypass as water separate from the pour total", () => {
    const recipe = {
      ...validRecipe,
      totalVolumeMl: 225,
      pours: [{ ...bloomPour, volumeMl: 225 }],
      bypass: { volumeMl: 40, tempC: 93 },
    };
    const result = validateRequest({ recipe, confirmSave: true });
    expect(result.recipe.bypass?.volumeMl).toBe(40);
  });

  it("rejects an incomplete pour total even when bypass is present", () => {
    const recipe = {
      ...validRecipe,
      totalVolumeMl: 225,
      pours: [{ ...bloomPour, volumeMl: 200 }],
      bypass: { volumeMl: 40, tempC: 93 },
    };
    expect(() => validateRequest({ recipe, confirmSave: true })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("rejects first pour label that is not Bloom", () => {
    const recipe = {
      ...validRecipe,
      pours: [{ ...bloomPour, label: "Pour 1", volumeMl: 225 }],
    };
    expect(() => validateRequest({ recipe, confirmSave: true })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("rejects mis-ordered labels in multi-pour recipe", () => {
    const recipe = {
      ...validRecipe,
      totalVolumeMl: 225,
      doseG: 15,
      brewRatio: "1:15",
      pours: [
        { ...bloomPour, volumeMl: 100 },
        { ...bloomPour, label: "Pour 3", volumeMl: 125 }, // wrong — should be Pour 2
      ],
    };
    expect(() => validateRequest({ recipe, confirmSave: true })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("rejects RPM not a multiple of 10", () => {
    const body = { recipe: { ...validRecipe, rpm: 85 }, confirmSave: true };
    expect(() => validateRequest(body)).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("rejects doseG out of range", () => {
    const body = {
      recipe: {
        ...validRecipe,
        doseG: 4,
        totalVolumeMl: 60,
        brewRatio: "1:15",
        pours: [{ ...bloomPour, volumeMl: 60 }],
      },
      confirmSave: true,
    };
    expect(() => validateRequest(body)).toThrowError();
  });

  it("rejects grindSize out of range", () => {
    const body = {
      recipe: { ...validRecipe, grindSize: 0, pours: [{ ...bloomPour, volumeMl: 225 }] },
      confirmSave: true,
    };
    expect(() => validateRequest(body)).toThrowError();
  });

  it("rejects tempC out of range in pour", () => {
    const body = {
      recipe: {
        ...validRecipe,
        pours: [{ ...bloomPour, volumeMl: 225, tempC: 100 }],
      },
      confirmSave: true,
    };
    expect(() => validateRequest(body)).toThrowError();
  });

  it("rejects flowRate out of bounds", () => {
    const body = {
      recipe: {
        ...validRecipe,
        pours: [{ ...bloomPour, volumeMl: 225, flowRateMlPerSec: 3.6 }],
      },
      confirmSave: true,
    };
    expect(() => validateRequest(body)).toThrowError();
  });

  it("accepts idempotencyKey", () => {
    const result = validateRequest({ ...validBody, idempotencyKey: "key-123" });
    expect(result.idempotencyKey).toBe("key-123");
  });

  // ── brewMode and icedServing ─────────────────────────────────────────────────

  // Canonical cold recipe fixture: 18 g dose, 1:10, 180 ml, 120 g ice → 300 ml total
  const coldPour = {
    label: "Bloom",
    volumeMl: 180,
    tempC: 93,
    flowRateMlPerSec: 3.0,
    pauseSec: 30,
    pattern: "centered" as const,
    agitationBefore: false,
    agitationAfter: false,
  };
  const coldRecipe = {
    name: "Ethiopia Iced Light Roast",
    machine: "xBloom Studio",
    dripper: "Omni" as const,
    brewRatio: "1:10",
    totalVolumeMl: 180,
    doseG: 18,
    grindSize: 19,
    rpm: 100,
    pours: [coldPour],
    brewMode: "cold" as const,
    icedServing: { iceG: 120, totalBeverageMl: 300, instruction: "Serve over 120 g ice." },
  };

  it("accepts cold recipe with correct icedServing and passes it through", () => {
    const result = validateRequest({ recipe: coldRecipe, confirmSave: true });
    expect(result.recipe.name).toBe("Ethiopia Iced Light Roast");
    expect(result.recipe.brewMode).toBe("cold");
    expect(result.recipe.icedServing?.iceG).toBe(120);
    expect(result.recipe.icedServing?.totalBeverageMl).toBe(300);
  });

  it("accepts the v1.2 neutral 300 ml cold cell with 129 g ice", () => {
    const recipe = {
      ...coldRecipe,
      dripper: "Other" as const,
      doseG: 19,
      brewRatio: "1:9",
      totalVolumeMl: 171,
      pours: [{ ...coldPour, volumeMl: 171 }],
      icedServing: { iceG: 129, totalBeverageMl: 300, instruction: "Serve over 129 g ice." },
    };

    expect(() => validateRequest({ recipe, confirmSave: true })).not.toThrow();
  });

  it("accepts the v1.2 bright 360 ml cold cell", () => {
    const recipe = {
      ...coldRecipe,
      dripper: "Other" as const,
      doseG: 24,
      brewRatio: "1:9",
      totalVolumeMl: 216,
      pours: [{ ...coldPour, volumeMl: 216 }],
      icedServing: { iceG: 144, totalBeverageMl: 360, instruction: "Serve over 144 g ice." },
    };

    expect(() => validateRequest({ recipe, confirmSave: true })).not.toThrow();
  });

  it("accepts brewMode=hot without icedServing", () => {
    const result = validateRequest({ ...validBody, recipe: { ...validRecipe, brewMode: "hot" } });
    expect(result.recipe.brewMode).toBe("hot");
    expect(result.recipe.icedServing).toBeUndefined();
  });

  it("accepts absent brewMode (backward compat — no icedServing check)", () => {
    const result = validateRequest(validBody);
    expect(result.recipe.brewMode).toBeUndefined();
  });

  it("absent brewMode with icedServing is accepted (backward compat)", () => {
    const icedServing = { iceG: 80, totalBeverageMl: 305, instruction: "Serve over ice." };
    const result = validateRequest({ ...validBody, recipe: { ...validRecipe, icedServing } });
    expect(result.recipe.icedServing?.iceG).toBe(80);
  });

  it("rejects invalid brewMode value", () => {
    const body = { recipe: { ...validRecipe, brewMode: "warm" }, confirmSave: true };
    expect(() => validateRequest(body)).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("accepts a valid cold recipe with a different dose", () => {
    const bad = {
      ...coldRecipe,
      doseG: 15,
      brewRatio: "1:10",
      totalVolumeMl: 150, // 15×10 — consistent but wrong dose
      pours: [{ ...coldPour, volumeMl: 150 }],
      icedServing: { iceG: 120, totalBeverageMl: 270, instruction: "ice" },
    };
    expect(() => validateRequest({ recipe: bad, confirmSave: true })).not.toThrow();
  });

  it("rejects Omni dripper with doseG above 18", () => {
    const body = {
      recipe: {
        ...validRecipe,
        dripper: "Omni" as const,
        doseG: 20,
        brewRatio: "1:11",
        totalVolumeMl: 220,
        pours: [{ ...bloomPour, volumeMl: 220 }],
      },
      confirmSave: true,
    };
    expect(() => validateRequest(body)).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("accepts Other dripper recipes up to 25g dose", () => {
    const strong = {
      ...validRecipe,
      dripper: "Other" as const,
      doseG: 25,
      brewRatio: "1:10",
      totalVolumeMl: 250,
      pours: [{ ...bloomPour, volumeMl: 250 }],
    };
    expect(() => validateRequest({ recipe: strong, confirmSave: true })).not.toThrow();
  });

  it("accepts a valid cold recipe with a different machine ratio", () => {
    const bad = {
      ...coldRecipe,
      brewRatio: "1:9",
      totalVolumeMl: 162, // 18×9
      pours: [{ ...coldPour, volumeMl: 162 }],
      icedServing: { iceG: 108, totalBeverageMl: 270, instruction: "ice" },
    };
    expect(() => validateRequest({ recipe: bad, confirmSave: true })).not.toThrow();
  });

  it("rejects cold recipe with totalVolumeMl !== 180 (inconsistent with 1:10)", () => {
    // totalVolumeMl 200 ≠ 18×10=180 — caught by ratio consistency check
    const bad = { ...coldRecipe, totalVolumeMl: 200 };
    expect(() => validateRequest({ recipe: bad, confirmSave: true })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  // Cold semantic guards
  it("rejects cold recipe missing icedServing", () => {
    const { icedServing: _removed, ...noIced } = coldRecipe;
    expect(() => validateRequest({ recipe: noIced, confirmSave: true })).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }),
    );
  });

  it("rejects cold recipe with wrong iceG", () => {
    const bad = {
      ...coldRecipe,
      icedServing: { ...coldRecipe.icedServing, iceG: 95, totalBeverageMl: 275 },
    };
    expect(() => validateRequest({ recipe: bad, confirmSave: true })).toThrowError(/iceG/);
  });

  it("rejects cold recipe with wrong totalBeverageMl", () => {
    const bad = {
      ...coldRecipe,
      icedServing: { ...coldRecipe.icedServing, totalBeverageMl: 999 },
    };
    expect(() => validateRequest({ recipe: bad, confirmSave: true })).toThrowError(
      /totalBeverageMl/,
    );
  });

  it("rejects cold recipe outside the 240..360 ml final drink range", () => {
    const bad = {
      ...coldRecipe,
      brewRatio: "1:13",
      totalVolumeMl: 234,
      pours: [{ ...coldPour, volumeMl: 234 }],
      icedServing: { ...coldRecipe.icedServing, iceG: 144, totalBeverageMl: 378 },
    };
    expect(() => validateRequest({ recipe: bad, confirmSave: true })).toThrowError(
      /total beverage/,
    );
  });

  it("rejects hot recipe that includes icedServing", () => {
    const hot = {
      ...validRecipe,
      brewMode: "hot" as const,
      icedServing: { iceG: 80, totalBeverageMl: 305, instruction: "oops" },
    };
    expect(() => validateRequest({ recipe: hot, confirmSave: true })).toThrowError(/icedServing/);
  });
});
