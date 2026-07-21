// ---------------------------------------------------------------------------
// Cloudflare Worker environment bindings
// ---------------------------------------------------------------------------

export interface Env {
  readonly AI: Ai;
  readonly DB: D1Database;
  readonly ASSETS?: Fetcher;
  readonly ALLOWED_ORIGINS?: string;
  /** Branded public origin used only to redirect legacy browser page URLs. */
  readonly CANONICAL_ORIGIN?: string;
  readonly TURNSTILE_SECRET_KEY?: string;
  /** Server-side OpenAI API key. Must be configured as a Worker secret. */
  readonly OPENAI_API_KEY?: string;
  /** SHA-256 hex digest of the bearer token used by the Mac bridge service. */
  readonly BRIDGE_TOKEN_HASH?: string;
}

// ---------------------------------------------------------------------------
// Bean metadata (extracted by Cloudflare Workers AI vision)
// ---------------------------------------------------------------------------

export type RoastLevel = "light" | "medium_light" | "medium" | "medium_dark" | "dark" | "unknown";

export interface BeanMetadata {
  /** Most prominent product/bean coffee name from the bag. "Unknown Bean" when unreliable. */
  beanName: string;
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

/** Iced serving metadata for cold brew-mode recipes. */
export interface IcedServingInstruction {
  iceG: number;
  totalBeverageMl: number;
  instruction: string;
}

export interface Recipe {
  name: string;
  machine: "xBloom Studio";
  dripper: Dripper;
  brewMode: BrewMode;
  brewRatio: string;
  totalVolumeMl: number;
  doseG: number;
  grindSize: number;
  rpm: number;
  pours: Pour[];
  bypass?: Bypass;
  bean: BeanMetadata;
  icedServing?: IcedServingInstruction;
}

// ---------------------------------------------------------------------------
// Auth context (available in route handlers after session validation)
// ---------------------------------------------------------------------------

export interface AuthContext {
  userId: string;
  username: string;
  role: "admin" | "user";
  authVersion: number;
}

// ---------------------------------------------------------------------------
// Bridge job
// ---------------------------------------------------------------------------

export type BridgeJobStatus = "pending" | "claimed" | "completed" | "failed";

// ---------------------------------------------------------------------------
// JSON response envelopes
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
