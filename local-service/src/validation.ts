import { z } from "zod";
import { ErrorCode, ServiceError } from "./errors.js";

const roastLevelSchema = z.enum([
  "light",
  "medium_light",
  "medium",
  "medium_dark",
  "dark",
  "unknown",
]);

const pourLabel = z
  .string()
  .refine((s) => s === "Bloom" || /^Pour \d+$/.test(s), "label must be 'Bloom' or 'Pour N'");

const pourSchema = z.object({
  label: pourLabel,
  volumeMl: z.number().int().min(1).max(250),
  tempC: z.number().int().min(40).max(95),
  flowRateMlPerSec: z
    .number()
    .min(3.0)
    .max(3.5)
    .refine((v) => {
      const steps = Math.round((v - 3.0) / 0.1);
      return Math.abs(v - (3.0 + steps * 0.1)) < 1e-9;
    }, "flowRate step must be 0.1"),
  pauseSec: z.number().int().min(0).max(59),
  pattern: z.enum(["centered", "spiral", "circular"]),
  agitationBefore: z.boolean(),
  agitationAfter: z.boolean(),
});

const bypassSchema = z.object({
  volumeMl: z.number().int().min(5).max(100),
  tempC: z.number().int().min(40).max(95),
});

const beanSchema = z.object({
  storeName: z.string().max(100).optional(),
  beanName: z.string().max(100).optional(),
  coffeeType: z.string().max(100),
  variety: z.string().max(100),
  origin: z.string().max(100),
  processingMethod: z.string().max(100),
  roastLevel: roastLevelSchema,
  flavors: z.array(z.string().max(50)).max(20),
  description: z.string().max(200),
});

// Accepted for schema completeness; ignored during Appium automation because
// the xBloom app has no cold-mode field.
const icedServingSchema = z.object({
  iceG: z.number().int().positive(),
  totalBeverageMl: z.number().int().positive(),
  instruction: z.string().max(1000),
});

const brewRatioPattern = /^1:(\d+)$/;

const recipeSchema = z.object({
  name: z.string().min(1).max(200),
  // Accept any machine string; MACHINE_NOT_SUPPORTED guard below rejects non-Studio values.
  machine: z.string().min(1),
  dripper: z.enum(["Omni", "xPod", "Other"]),
  brewRatio: z.string().regex(brewRatioPattern, "brewRatio must be '1:N'"),
  totalVolumeMl: z.number().int().positive(),
  doseG: z.number().int().min(5).max(25),
  grindSize: z.number().int().min(1).max(80),
  rpm: z
    .number()
    .int()
    .min(60)
    .max(120)
    .refine((v) => v % 10 === 0, "rpm must be a multiple of 10"),
  pours: z.array(pourSchema).min(1).max(4),
  bypass: bypassSchema.optional(),
  bean: beanSchema.optional(),
  // brewMode and icedServing are accepted for schema completeness.
  // They are not entered into the xBloom app (which has no cold-mode field).
  brewMode: z.enum(["cold", "hot"]).optional(),
  icedServing: icedServingSchema.optional(),
});

export const requestSchema = z
  .object({
    recipe: recipeSchema,
    dryRun: z.boolean().optional(),
    confirmSave: z.boolean().optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.dryRun === true && val.confirmSave === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dryRun and confirmSave are mutually exclusive",
        path: ["dryRun"],
      });
    }
    if (!val.dryRun && !val.confirmSave) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of dryRun:true or confirmSave:true is required",
        path: ["confirmSave"],
      });
    }
  });

export type ValidatedRequest = z.infer<typeof requestSchema>;

export function validateRequest(body: unknown): ValidatedRequest {
  const result = requestSchema.safeParse(body);
  if (!result.success) {
    const msg = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw new ServiceError(ErrorCode.VALIDATION_ERROR, msg, 422);
  }

  const { recipe } = result.data;

  // Machine guard — must be exactly xBloom Studio
  if (recipe.machine !== "xBloom Studio") {
    throw new ServiceError(
      ErrorCode.MACHINE_NOT_SUPPORTED,
      `Only 'xBloom Studio' is supported`,
      422,
    );
  }

  // xPod dose is fixed at 15g
  if (recipe.dripper === "xPod" && recipe.doseG !== 15) {
    throw new ServiceError(
      ErrorCode.VALIDATION_ERROR,
      "xPod recipes require a fixed dose of 15g",
      422,
    );
  }

  // Ratio consistency
  const match = brewRatioPattern.exec(recipe.brewRatio);
  const ratioN = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
  const expectedVolume = recipe.doseG * ratioN;
  if (recipe.totalVolumeMl !== expectedVolume) {
    throw new ServiceError(
      ErrorCode.VALIDATION_ERROR,
      `totalVolumeMl (${recipe.totalVolumeMl}) must equal doseG×ratio (${recipe.doseG}×${ratioN}=${expectedVolume})`,
      422,
    );
  }

  // Pour sum must exactly equal totalVolumeMl; bypass is separate and not counted
  const pourSum = recipe.pours.reduce((s, p) => s + p.volumeMl, 0);
  if (pourSum !== recipe.totalVolumeMl) {
    throw new ServiceError(
      ErrorCode.VALIDATION_ERROR,
      `Sum of pour volumes (${pourSum}) must equal totalVolumeMl (${recipe.totalVolumeMl}); bypass water is separate and must not be included`,
      422,
    );
  }

  // Pour label ordering
  validatePourLabels(recipe.pours.map((p) => p.label));

  // Cold/hot metadata consistency (brewMode absent = backward-compatible, no check).
  // The xBloom app has no cold-mode field; these fields are accepted and stored only.
  if (recipe.brewMode === "cold") {
    if (!recipe.icedServing) {
      throw new ServiceError(
        ErrorCode.VALIDATION_ERROR,
        "Cold recipes must include icedServing metadata",
        422,
      );
    }
    if (recipe.icedServing.iceG < 96 || recipe.icedServing.iceG > 144) {
      throw new ServiceError(
        ErrorCode.VALIDATION_ERROR,
        `Cold recipe icedServing.iceG must be 96..144; got ${recipe.icedServing.iceG}`,
        422,
      );
    }
    const expectedTotal = recipe.totalVolumeMl + recipe.icedServing.iceG;
    if (recipe.icedServing.totalBeverageMl !== expectedTotal) {
      throw new ServiceError(
        ErrorCode.VALIDATION_ERROR,
        `Cold recipe icedServing.totalBeverageMl must equal water+ice (${expectedTotal}); got ${recipe.icedServing.totalBeverageMl}`,
        422,
      );
    }
    if (expectedTotal < 240 || expectedTotal > 360) {
      throw new ServiceError(
        ErrorCode.VALIDATION_ERROR,
        `Cold recipe total beverage must be 240..360 ml; got ${expectedTotal}`,
        422,
      );
    }
    const overallRatio = expectedTotal / recipe.doseG;
    if (overallRatio < 12 || overallRatio > 20) {
      throw new ServiceError(
        ErrorCode.VALIDATION_ERROR,
        "Cold recipe overall beverage ratio must be between 1:12 and 1:20",
        422,
      );
    }
  }

  if (recipe.brewMode === "hot" && recipe.icedServing !== undefined) {
    throw new ServiceError(
      ErrorCode.VALIDATION_ERROR,
      "Hot recipes must not include icedServing",
      422,
    );
  }

  return result.data;
}

function validatePourLabels(labels: string[]): void {
  if (labels.length === 0) return;
  if (labels[0] !== "Bloom") {
    throw new ServiceError(ErrorCode.VALIDATION_ERROR, "First pour label must be 'Bloom'", 422);
  }
  for (let i = 1; i < labels.length; i++) {
    const expected = `Pour ${i + 1}`;
    if (labels[i] !== expected) {
      throw new ServiceError(
        ErrorCode.VALIDATION_ERROR,
        `Pour label at index ${i} must be '${expected}', got '${labels[i]}'`,
        422,
      );
    }
  }
}
