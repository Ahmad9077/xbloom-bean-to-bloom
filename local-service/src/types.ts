export interface Pour {
  label: string;
  volumeMl: number;
  tempC: number;
  flowRateMlPerSec: number;
  pauseSec: number;
  pattern: "centered" | "spiral" | "circular";
  agitationBefore: boolean;
  agitationAfter: boolean;
}

export interface Bypass {
  volumeMl: number;
  tempC: number;
}

export interface Bean {
  coffeeType: string;
  variety: string;
  origin: string;
  processingMethod: string;
  roastLevel: "light" | "medium" | "dark";
  flavors: string[];
  description: string;
}

/** Iced serving metadata. The app has no cold setting; this field is accepted
 *  but not entered into the xBloom Studio app during automation. */
export interface IcedServingInstruction {
  iceG: number;
  totalBeverageMl: number;
  instruction: string;
}

/** "cold" = iced pour-over (machine brews hot; served over ice outside the machine).
 *  "hot"  = standard hot pour-over.
 *  Accepted by this service for schema completeness; ignored during automation
 *  because the xBloom app has no cold-mode field. */
export type BrewMode = "cold" | "hot";

export interface Recipe {
  name: string;
  machine: string;
  dripper: "Omni" | "xPod" | "Other";
  brewRatio: string;
  totalVolumeMl: number;
  doseG: number;
  grindSize: number;
  rpm: number;
  pours: Pour[];
  bypass?: Bypass | undefined;
  bean?: Bean | undefined;
  /** Accepted and stored but not entered into the app (app has no cold-mode field). */
  brewMode?: BrewMode | undefined;
  /** Accepted and stored but not entered into the app. */
  icedServing?: IcedServingInstruction | undefined;
}

export interface RecipeRequest {
  recipe: Recipe;
  dryRun?: boolean;
  confirmSave?: boolean;
  idempotencyKey?: string;
}

export interface JobResult {
  ok: true;
  jobId: string;
  requestId: string;
  dryRun: boolean;
  confirmed: boolean;
  recipeName: string;
  message: string;
}

export interface AppError {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse = JobResult | AppError;

export interface SliderBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Config {
  port: number;
  appiumUrl: string;
  allowedOrigins: Set<string>;
  allowedHosts: Set<string>;
  expectedAppVersion: string;
  skipVersionCheck: boolean;
  elementTimeoutMs: number;
  sliderMaxRetries: number;
  screenshotDir: string;
  idempotencyTtlMs: number;
}
