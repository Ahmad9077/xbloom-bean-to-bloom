import { InternalError } from "./errors.js";
import type {
  BeanMetadata,
  BrewMode,
  Dripper,
  IcedServingInstruction,
  Pour,
  PourPattern,
  Recipe,
  RoastLevel,
} from "./types.js";
import { validateBeanMetadata } from "./vision.js";

// ---------------------------------------------------------------------------
// Service metadata limits (imposed by the upstream recipe service, not xBloom hardware)
// ---------------------------------------------------------------------------
export const RECIPE_NAME_MAX_LEN = 200;

// ---------------------------------------------------------------------------
// App-verified limits (Phase 2)
// ---------------------------------------------------------------------------
const DOSE_MIN = 5;
const DOSE_MAX = 18;
const RATIO_MIN = 5;
const RATIO_MAX = 25;
const GRIND_MIN = 1;
const GRIND_MAX = 80;
const RPM_MIN = 60;
const RPM_MAX = 120;
const RPM_STEP = 10;
const FLOW_MIN = 3.0;
const FLOW_MAX = 3.5;
const FLOW_STEP = 0.1;
const TEMP_MIN = 40;
const TEMP_MAX = 95;
const POUR_VOL_MIN = 0; // lower allocation bound; pour validation requires > 0
const POUR_VOL_MAX = 240;
const PAUSE_MIN = 2;
const PAUSE_MAX = 59;
const BYPASS_VOL_MIN = 5;
const BYPASS_VOL_MAX = 100;

const VALID_DRIPPERS: ReadonlySet<Dripper> = new Set(["Omni", "xPod", "Other"]);

// ---------------------------------------------------------------------------
// Cold recipe constants — machine brews hot; ice is added outside the machine
// ---------------------------------------------------------------------------

/** Fixed machine-water ratio for all cold recipes (16 g dose → 160 ml). */
const COLD_RATIO_N = 10;
/** Grams of ice added outside the machine, yielding a 300 ml serving. */
export const COLD_ICE_G = 140;
export const COLD_TOTAL_MIN_ML = 280;
export const COLD_TOTAL_MAX_ML = 320;

// ---------------------------------------------------------------------------
// Deterministic base parameters by roast level
// ---------------------------------------------------------------------------

interface RoastParams {
  readonly grindSize: number;
  readonly baseTemp: number;
  readonly rpm: number;
  readonly ratioN: number;
  readonly bloomPauseSec: number;
  readonly pour2PauseSec: number;
  readonly pour3PauseSec: number;
  readonly flowRate: number;
  readonly bloomTempOffset: number;
  readonly pour3TempOffset: number;
}

const ROAST_PARAMS: Record<RoastLevel, RoastParams> = {
  light: {
    grindSize: 20,
    baseTemp: 93,
    rpm: 100,
    ratioN: 14,
    bloomPauseSec: 40,
    pour2PauseSec: 20,
    pour3PauseSec: 10,
    flowRate: 3.0,
    bloomTempOffset: -1,
    pour3TempOffset: 1,
  },
  medium: {
    grindSize: 25,
    baseTemp: 91,
    rpm: 90,
    ratioN: 12,
    bloomPauseSec: 35,
    pour2PauseSec: 15,
    pour3PauseSec: 5,
    flowRate: 3.0,
    bloomTempOffset: -1,
    pour3TempOffset: 1,
  },
  dark: {
    grindSize: 35,
    baseTemp: 87,
    rpm: 70,
    ratioN: 10,
    bloomPauseSec: 30,
    pour2PauseSec: 10,
    pour3PauseSec: 0,
    flowRate: 3.2,
    bloomTempOffset: 0,
    pour3TempOffset: 0,
  },
};

// ---------------------------------------------------------------------------
// Processing-method adjustments (bounded, deterministic)
// ---------------------------------------------------------------------------

function processingAdjustments(method: string): { grindDelta: number; tempDelta: number } {
  const m = method.toLowerCase();
  if (m.includes("washed") || m.includes("wet")) {
    return { grindDelta: -1, tempDelta: 1 };
  }
  if (m.includes("natural") || m.includes("dry") || m.includes("sun")) {
    return { grindDelta: 2, tempDelta: -1 };
  }
  if (m.includes("honey") || m.includes("pulped")) {
    return { grindDelta: 1, tempDelta: 0 };
  }
  return { grindDelta: 0, tempDelta: 0 };
}

// ---------------------------------------------------------------------------
// Quantization helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function quantizeStep(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function clampInt(v: number, min: number, max: number): number {
  return clamp(Math.round(v), min, max);
}

function clampRpm(v: number): number {
  const q = quantizeStep(v, RPM_STEP);
  return clamp(q, RPM_MIN, RPM_MAX);
}

function clampFlowRate(v: number): number {
  const q = Math.round(quantizeStep(v, FLOW_STEP) * 10) / 10;
  return clamp(q, FLOW_MIN, FLOW_MAX);
}

function clampTemp(v: number): number {
  return clampInt(v, TEMP_MIN, TEMP_MAX);
}

function clampGrind(v: number): number {
  return clampInt(v, GRIND_MIN, GRIND_MAX);
}

function clampPause(v: number): number {
  return clampInt(v, PAUSE_MIN, PAUSE_MAX);
}

// ---------------------------------------------------------------------------
// Pour volume allocation — ensures integer volumes that sum exactly to total
// ---------------------------------------------------------------------------

/**
 * Allocate 3 integer pour volumes that sum exactly to `totalMl`.
 * Bloom fraction varies by roast. Remainder is split 60/40 between pours 2 and 3.
 */
function allocatePourVolumes(totalMl: number, roastLevel: RoastLevel): [number, number, number] {
  const bloomFraction = roastLevel === "light" ? 0.22 : roastLevel === "medium" ? 0.25 : 0.34;
  const bloom = clamp(Math.round(totalMl * bloomFraction), POUR_VOL_MIN + 1, POUR_VOL_MAX);
  const remaining = totalMl - bloom;
  const pour2 = clamp(Math.round(remaining * 0.6), POUR_VOL_MIN + 1, POUR_VOL_MAX);
  const pour3 = remaining - pour2; // derived: guarantees exact sum
  return [bloom, pour2, pour3];
}

// ---------------------------------------------------------------------------
// Public recipe generator
// ---------------------------------------------------------------------------

/**
 * Deterministically generate an xBloom Studio recipe from extracted bean metadata.
 * All outputs are clamped and quantized to verified app limits.
 *
 * brewMode defaults to "hot" for backward compatibility with existing tests and callers.
 * The API layer defaults missing brewMode to "cold" per the product default.
 *
 * Cold mode: machine brews hot water at a fixed 1:10 ratio (16 g → 160 ml).
 * The xBloom machine has no cold setting; 140 g ice yields a 300 ml serving.
 */
export function generateRecipe(
  bean: BeanMetadata,
  dripper: Dripper = "Omni",
  brewMode: BrewMode = "hot",
): Recipe {
  const params = ROAST_PARAMS[bean.roastLevel];
  const { grindDelta, tempDelta } = processingAdjustments(bean.processingMethod);

  const doseG = 16; // fixed dose within 5..18 g range

  // Cold: fixed 1:10 machine-water ratio regardless of roast.
  // Hot: use roast-derived ratio clamped to app bounds.
  const ratioN = brewMode === "cold" ? COLD_RATIO_N : clamp(params.ratioN, RATIO_MIN, RATIO_MAX);
  const totalVolumeMl = doseG * ratioN;

  const grindSize = clampGrind(params.grindSize + grindDelta);
  const rpm = clampRpm(params.rpm);
  const flowRate = clampFlowRate(params.flowRate);

  const baseTemp = clamp(params.baseTemp + tempDelta, TEMP_MIN, TEMP_MAX);
  const bloomTemp = clampTemp(baseTemp + params.bloomTempOffset);
  const pour2Temp = clampTemp(baseTemp);
  const pour3Temp = clampTemp(baseTemp + params.pour3TempOffset);

  const [bloomVol, pour2Vol, pour3Vol] = allocatePourVolumes(totalVolumeMl, bean.roastLevel);

  const pattern: PourPattern = "centered";

  const pours: Pour[] = [
    {
      label: "Bloom",
      volumeMl: bloomVol,
      tempC: bloomTemp,
      flowRateMlPerSec: flowRate,
      pauseSec: clampPause(params.bloomPauseSec),
      pattern,
      agitationBefore: false,
      agitationAfter: false,
    },
    {
      label: "Pour 2",
      volumeMl: pour2Vol,
      tempC: pour2Temp,
      flowRateMlPerSec: flowRate,
      pauseSec: clampPause(params.pour2PauseSec),
      pattern,
      agitationBefore: false,
      agitationAfter: false,
    },
    {
      label: "Pour 3",
      volumeMl: pour3Vol,
      tempC: pour3Temp,
      flowRateMlPerSec: flowRate,
      pauseSec: clampPause(params.pour3PauseSec),
      pattern,
      agitationBefore: false,
      agitationAfter: false,
    },
  ];

  const origin = bean.origin ? `${bean.origin} ` : "";
  const roastLabel = bean.roastLevel.charAt(0).toUpperCase() + bean.roastLevel.slice(1);
  const name =
    brewMode === "cold"
      ? `${origin}Iced ${roastLabel} Roast`.trim()
      : `${origin}${roastLabel} Roast`.trim();

  const icedServing: IcedServingInstruction | undefined =
    brewMode === "cold"
      ? {
          iceG: COLD_ICE_G,
          totalBeverageMl: totalVolumeMl + COLD_ICE_G,
          instruction: `Serve over ${COLD_ICE_G} g ice outside the xBloom machine. The machine brews ${totalVolumeMl} ml of hot coffee which chills over the ice, yielding ${totalVolumeMl + COLD_ICE_G} ml total at an overall 1:${Math.round((totalVolumeMl + COLD_ICE_G) / doseG)} ratio. The xBloom machine has no cold setting — it always brews hot water.`,
        }
      : undefined;

  return {
    name,
    machine: "xBloom Studio",
    dripper,
    brewMode,
    brewRatio: `1:${ratioN}`,
    totalVolumeMl,
    doseG,
    grindSize,
    rpm,
    pours,
    bean,
    ...(icedServing !== undefined && { icedServing }),
  };
}

// ---------------------------------------------------------------------------
// Invariant validation (runtime guard — recipes should not be AI-generated)
// ---------------------------------------------------------------------------

/**
 * Validate all recipe invariants and throw InternalError if any fail.
 * Called after generateRecipe() as a defence-in-depth check.
 */
export function validateRecipeInvariants(recipe: Recipe): void {
  const { name, machine, dripper, doseG, totalVolumeMl, grindSize, rpm, pours, bypass, brewMode } =
    recipe;

  // brewMode
  if (brewMode !== "cold" && brewMode !== "hot") {
    throw new InternalError(`brewMode must be "cold" or "hot"; got "${String(brewMode)}"`);
  }

  // Top-level string/identity fields
  if (typeof name !== "string" || name.trim() === "") {
    throw new InternalError("Recipe name must be a nonempty string");
  }
  if (name.length > RECIPE_NAME_MAX_LEN) {
    throw new InternalError(
      `Recipe name length ${name.length} exceeds service maximum of ${RECIPE_NAME_MAX_LEN}`,
    );
  }
  if (machine !== "xBloom Studio") {
    throw new InternalError(`Recipe machine must be "xBloom Studio"; got "${machine}"`);
  }
  if (!VALID_DRIPPERS.has(dripper)) {
    throw new InternalError(`Recipe dripper "${dripper}" must be one of Omni, xPod, Other`);
  }

  // Bean metadata
  try {
    validateBeanMetadata(recipe.bean);
  } catch {
    throw new InternalError("Recipe contains invalid bean metadata");
  }

  // Dose
  if (!Number.isFinite(doseG) || !Number.isInteger(doseG) || doseG < DOSE_MIN || doseG > DOSE_MAX) {
    throw new InternalError(`doseG ${doseG} out of range ${DOSE_MIN}..${DOSE_MAX}`);
  }

  // Brew ratio format
  const ratioMatch = recipe.brewRatio.match(/^1:(\d+)$/);
  if (!ratioMatch) {
    throw new InternalError(`brewRatio "${recipe.brewRatio}" does not match "1:N" format`);
  }
  const ratioN = Number.parseInt(ratioMatch[1] as string, 10);
  if (ratioN < RATIO_MIN || ratioN > RATIO_MAX) {
    throw new InternalError(`Ratio denominator ${ratioN} out of range ${RATIO_MIN}..${RATIO_MAX}`);
  }

  // Total volume = dose × ratio
  if (!Number.isFinite(totalVolumeMl) || !Number.isInteger(totalVolumeMl)) {
    throw new InternalError(`totalVolumeMl ${totalVolumeMl} must be a finite integer`);
  }
  if (totalVolumeMl !== doseG * ratioN) {
    throw new InternalError(`totalVolumeMl ${totalVolumeMl} ≠ doseG(${doseG}) × ratioN(${ratioN})`);
  }

  // Grind size
  if (
    !Number.isFinite(grindSize) ||
    !Number.isInteger(grindSize) ||
    grindSize < GRIND_MIN ||
    grindSize > GRIND_MAX
  ) {
    throw new InternalError(`grindSize ${grindSize} out of range ${GRIND_MIN}..${GRIND_MAX}`);
  }

  // RPM
  if (
    !Number.isFinite(rpm) ||
    !Number.isInteger(rpm) ||
    rpm < RPM_MIN ||
    rpm > RPM_MAX ||
    rpm % RPM_STEP !== 0
  ) {
    throw new InternalError(`rpm ${rpm} invalid (${RPM_MIN}..${RPM_MAX}, step ${RPM_STEP})`);
  }

  // Pours non-empty
  if (!Array.isArray(pours) || pours.length === 0) {
    throw new InternalError("Recipe must have at least one pour");
  }

  let pourSum = 0;
  for (let i = 0; i < pours.length; i++) {
    const pour = pours[i] as Pour;
    const expectedLabel = i === 0 ? "Bloom" : `Pour ${i + 1}`;
    if (!pour.label || pour.label.trim() === "") {
      throw new InternalError(`Pour ${i} label must not be empty`);
    }
    if (pour.label !== expectedLabel) {
      throw new InternalError(`Pour ${i} label must be "${expectedLabel}"; got "${pour.label}"`);
    }

    if (
      !Number.isFinite(pour.volumeMl) ||
      !Number.isInteger(pour.volumeMl) ||
      pour.volumeMl <= 0 ||
      pour.volumeMl > POUR_VOL_MAX
    ) {
      throw new InternalError(
        `Pour "${pour.label}" volumeMl ${pour.volumeMl} must be a positive integer ≤${POUR_VOL_MAX}`,
      );
    }

    if (
      !Number.isFinite(pour.tempC) ||
      !Number.isInteger(pour.tempC) ||
      pour.tempC < TEMP_MIN ||
      pour.tempC > TEMP_MAX
    ) {
      throw new InternalError(`Pour "${pour.label}" tempC ${pour.tempC} out of range`);
    }

    // Flow rate: in range and quantized to FLOW_STEP (tolerate floating-point imprecision)
    const flowTenths = Math.round(pour.flowRateMlPerSec * 10);
    if (
      !Number.isFinite(pour.flowRateMlPerSec) ||
      flowTenths < Math.round(FLOW_MIN * 10) ||
      flowTenths > Math.round(FLOW_MAX * 10) ||
      Math.abs(flowTenths / 10 - pour.flowRateMlPerSec) > 1e-9
    ) {
      throw new InternalError(
        `Pour "${pour.label}" flowRate ${pour.flowRateMlPerSec} must be ${FLOW_MIN}..${FLOW_MAX} in steps of ${FLOW_STEP}`,
      );
    }

    if (
      !Number.isFinite(pour.pauseSec) ||
      !Number.isInteger(pour.pauseSec) ||
      pour.pauseSec < PAUSE_MIN ||
      pour.pauseSec > PAUSE_MAX
    ) {
      throw new InternalError(`Pour "${pour.label}" pauseSec ${pour.pauseSec} out of range`);
    }

    if (!["centered", "spiral", "circular"].includes(pour.pattern)) {
      throw new InternalError(`Pour "${pour.label}" pattern "${pour.pattern}" is invalid`);
    }

    if (typeof pour.agitationBefore !== "boolean") {
      throw new InternalError(`Pour "${pour.label}" agitationBefore must be a boolean`);
    }
    if (typeof pour.agitationAfter !== "boolean") {
      throw new InternalError(`Pour "${pour.label}" agitationAfter must be a boolean`);
    }

    pourSum += pour.volumeMl;
  }

  const bypassVol = bypass?.volumeMl ?? 0;
  if (bypass !== undefined) {
    if (
      !Number.isFinite(bypassVol) ||
      !Number.isInteger(bypassVol) ||
      bypassVol < BYPASS_VOL_MIN ||
      bypassVol > BYPASS_VOL_MAX
    ) {
      throw new InternalError(`bypass.volumeMl ${bypassVol} out of range`);
    }
    if (
      !Number.isFinite(bypass.tempC) ||
      !Number.isInteger(bypass.tempC) ||
      bypass.tempC < TEMP_MIN ||
      bypass.tempC > TEMP_MAX
    ) {
      throw new InternalError(`bypass.tempC ${bypass.tempC} out of range`);
    }
  }

  const total = pourSum + bypassVol;
  if (total !== totalVolumeMl) {
    throw new InternalError(
      `Pour sum (${pourSum}) + bypass (${bypassVol}) = ${total} ≠ totalVolumeMl (${totalVolumeMl})`,
    );
  }

  // Cold-mode invariants
  if (brewMode === "cold") {
    if (!recipe.icedServing) {
      throw new InternalError("Cold recipe must have icedServing");
    }
    if (
      !Number.isInteger(recipe.icedServing.iceG) ||
      recipe.icedServing.iceG < 100 ||
      recipe.icedServing.iceG > 160
    ) {
      throw new InternalError("Cold recipe icedServing.iceG must be an integer from 100..160");
    }
    const expectedTotal = totalVolumeMl + recipe.icedServing.iceG;
    if (recipe.icedServing.totalBeverageMl !== expectedTotal) {
      throw new InternalError(
        `Cold recipe icedServing.totalBeverageMl must be ${expectedTotal}; got ${recipe.icedServing.totalBeverageMl}`,
      );
    }
    if (expectedTotal < COLD_TOTAL_MIN_ML || expectedTotal > COLD_TOTAL_MAX_ML) {
      throw new InternalError(
        `Cold recipe total beverage must be ${COLD_TOTAL_MIN_ML}..${COLD_TOTAL_MAX_ML} ml`,
      );
    }
    const overallRatio = expectedTotal / doseG;
    if (overallRatio < 12 || overallRatio > 20) {
      throw new InternalError("Cold recipe total beverage ratio must be between 1:12 and 1:20");
    }
    if (
      typeof recipe.icedServing.instruction !== "string" ||
      recipe.icedServing.instruction.trim() === "" ||
      recipe.icedServing.instruction.length > 500
    ) {
      throw new InternalError("Cold recipe icedServing.instruction is invalid");
    }
  }

  // Hot-mode invariants
  if (brewMode === "hot" && recipe.icedServing !== undefined) {
    throw new InternalError("Hot recipe must not have icedServing");
  }
}
