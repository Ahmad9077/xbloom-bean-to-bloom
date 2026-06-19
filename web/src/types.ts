export type BrewMode = "cold" | "hot";

export interface BeanMetadata {
  coffeeType: string;
  variety: string;
  origin: string;
  processingMethod: string;
  roastLevel: "light" | "medium" | "dark";
  flavors: string[];
  description: string;
}

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

export interface IcedServingInstruction {
  iceG: number;
  totalBeverageMl: number;
  instruction: string;
}

export interface Recipe {
  name: string;
  machine: string;
  dripper: string;
  brewMode: BrewMode;
  brewRatio: string;
  totalVolumeMl: number;
  doseG: number;
  grindSize: number;
  rpm: number;
  pours: Pour[];
  bean: BeanMetadata;
  icedServing?: IcedServingInstruction;
}

export interface RecipeSuccess {
  ok: true;
  requestId: string;
  recipe: Recipe;
}

export interface ApiError {
  ok: false;
  requestId: string;
  error: {
    code: string;
    message: string;
  };
}

export type WorkerResponse = RecipeSuccess | ApiError;

export interface BridgeSuccess {
  ok: true;
  jobId: string;
  requestId: string;
  recipeName: string;
  message: string;
}

export interface BridgeError {
  ok: false;
  requestId?: string;
  error: {
    code: string;
    message: string;
  };
}

export type BridgeResponse = BridgeSuccess | BridgeError;
