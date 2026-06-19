// ---------------------------------------------------------------------------
// Cloudflare Worker environment bindings
// ---------------------------------------------------------------------------

export interface Env {
  /** Cloudflare Workers AI binding — declared in wrangler.toml [ai] binding = "AI" */
  readonly AI: Ai;
  /** Comma-separated list of allowed CORS origins; empty = deny all cross-origin */
  readonly ALLOWED_ORIGINS?: string;
  /** Cloudflare Turnstile secret key; absent = Turnstile disabled */
  readonly TURNSTILE_SECRET_KEY?: string;
}

// ---------------------------------------------------------------------------
// Bean metadata (extracted by Workers AI vision)
// ---------------------------------------------------------------------------

export type RoastLevel = "light" | "medium" | "dark";

export interface BeanMetadata {
  coffeeType: string;
  variety: string;
  origin: string;
  processingMethod: string;
  roastLevel: RoastLevel;
  flavors: string[];
  description: string;
}

// ---------------------------------------------------------------------------
// xBloom Studio recipe schema
// ---------------------------------------------------------------------------

export type Dripper = "Omni" | "xPod" | "Other";
export type PourPattern = "centered" | "spiral" | "circular";

/** "cold" = iced pour-over: machine brews hot, drink served over ice outside the machine.
 *  "hot"  = standard hot pour-over. */
export type BrewMode = "cold" | "hot";

export interface Pour {
  label: string;
  volumeMl: number;
  tempC: number;
  flowRateMlPerSec: number;
  pauseSec: number;
  pattern: PourPattern;
  agitationBefore: boolean;
  agitationAfter: boolean;
}

export interface Bypass {
  volumeMl: number;
  tempC: number;
}

/** Iced serving metadata for cold brew-mode recipes.
 *  The xBloom machine itself has no cold setting — it brews hot water.
 *  Ice is added outside the machine after brewing. */
export interface IcedServingInstruction {
  /** Grams of ice to add outside the machine after brewing. */
  iceG: number;
  /** Total beverage volume including ice melt: machine water + ice. */
  totalBeverageMl: number;
  /** Human-readable serving instruction. */
  instruction: string;
}

export interface Recipe {
  name: string;
  machine: "xBloom Studio";
  dripper: Dripper;
  /** Brew mode selected by the user before analysis. */
  brewMode: BrewMode;
  brewRatio: string;
  totalVolumeMl: number;
  doseG: number;
  grindSize: number;
  rpm: number;
  pours: Pour[];
  bypass?: Bypass;
  bean: BeanMetadata;
  /** Present only when brewMode is "cold". */
  icedServing?: IcedServingInstruction;
}

// ---------------------------------------------------------------------------
// JSON response envelope
// ---------------------------------------------------------------------------

export interface SuccessEnvelope {
  ok: true;
  requestId: string;
  recipe: Recipe;
}

export interface ErrorEnvelope {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
  };
}

export interface HealthResponse {
  ok: true;
  requestId: string;
  status: "ok";
}

export type ResponseEnvelope = SuccessEnvelope | ErrorEnvelope | HealthResponse;

// ---------------------------------------------------------------------------
// Turnstile verification
// ---------------------------------------------------------------------------

export interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes": string[];
}
